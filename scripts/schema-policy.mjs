#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { parse } from 'pgsql-parser';

const [command, rootArgument = '.'] = process.argv.slice(2);
const root = path.resolve(rootArgument);
const LINEAGE_ALGORITHM = 'sha256-chain-v1';
const LINEAGE_DOMAIN = 'chattermost-schema-lineage-v1';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function migrationEntries(base) {
  const migrationsRoot = path.join(base, 'prisma', 'migrations');
  const names = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(path.join(migrationsRoot, name, 'migration.sql'), 'utf8');
      return { name, sql };
    })
  );
}

function statementName(node) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return undefined;
  const keys = Object.keys(node);
  return keys.length === 1 ? keys[0] : undefined;
}

function findNode(node, names) {
  if (node === null || typeof node !== 'object') return undefined;
  if (!Array.isArray(node)) {
    const name = statementName(node);
    if (name !== undefined && names.has(name)) return name;
  }
  for (const value of Array.isArray(node) ? node : Object.values(node)) {
    const found = findNode(value, names);
    if (found !== undefined) return found;
  }
  return undefined;
}

const destructiveNodes = new Set([
  'AlterDatabaseStmt',
  'AlterDefaultPrivilegesStmt',
  'AlterDomainStmt',
  'AlterEnumStmt',
  'AlterFunctionStmt',
  'AlterObjectDependsStmt',
  'AlterObjectSchemaStmt',
  'AlterOwnerStmt',
  'AlterPolicyStmt',
  'AlterRoleStmt',
  'AlterSeqStmt',
  'AlterSystemStmt',
  'CallStmt',
  'CopyStmt',
  'CreateFunctionStmt',
  'CreatePolicyStmt',
  'CreateRoleStmt',
  'DeleteStmt',
  'DoStmt',
  'DropStmt',
  'GrantStmt',
  'GrantRoleStmt',
  'InsertStmt',
  'MergeStmt',
  'ReindexStmt',
  'RenameStmt',
  'RuleStmt',
  'SecLabelStmt',
  'TransactionStmt',
  'TruncateStmt',
  'UpdateStmt',
  'VacuumStmt',
  'VariableSetStmt'
]);

function isNonNullConstant(expression) {
  if (expression?.A_Const !== undefined) return expression.A_Const.isnull !== true;
  if (expression?.TypeCast !== undefined) return isNonNullConstant(expression.TypeCast.arg);
  if (expression?.CollateClause !== undefined)
    return isNonNullConstant(expression.CollateClause.arg);
  return false;
}

function validateAddedColumn(command) {
  const column = command.def?.ColumnDef;
  if (column === undefined)
    throw new Error('ADD COLUMN must contain a structural column definition');
  const typeName = column.typeName?.names?.at(-1)?.String?.sval;
  if (['smallserial', 'serial', 'bigserial'].includes(typeName)) {
    throw new Error(`ADD COLUMN ${column.colname} uses an implicit sequence and non-null default`);
  }
  const constraints = (column.constraints ?? []).map((entry) => entry.Constraint).filter(Boolean);
  const unsupported = constraints.find(
    (constraint) =>
      !['CONSTR_NULL', 'CONSTR_NOTNULL', 'CONSTR_DEFAULT'].includes(constraint.contype)
  );
  if (unsupported !== undefined) {
    throw new Error(
      `ADD COLUMN ${column.colname} contains unsafe ${unsupported.contype} compatibility behavior`
    );
  }
  const notNull = constraints.some((constraint) => constraint.contype === 'CONSTR_NOTNULL');
  const defaultConstraint = constraints.find(
    (constraint) => constraint.contype === 'CONSTR_DEFAULT'
  );
  if (
    notNull &&
    (defaultConstraint === undefined || !isNonNullConstant(defaultConstraint.raw_expr))
  ) {
    throw new Error(
      `ADD COLUMN ${column.colname} is NOT NULL without a safe non-null constant default`
    );
  }
  if (defaultConstraint !== undefined && !isNonNullConstant(defaultConstraint.raw_expr)) {
    throw new Error(`ADD COLUMN ${column.colname} uses a non-constant default`);
  }
}

function validateAddedConstraint(command) {
  const constraint = command.def?.Constraint;
  const canRemainUnvalidated =
    constraint !== undefined &&
    ['CONSTR_CHECK', 'CONSTR_FOREIGN'].includes(constraint.contype) &&
    constraint.skip_validation === true &&
    constraint.initially_valid !== true;
  if (!canRemainUnvalidated) {
    throw new Error(
      'ALTER TABLE constraints must be new CHECK or FOREIGN KEY constraints declared NOT VALID'
    );
  }
}

function validateAlterTable(statement) {
  for (const entry of statement.cmds ?? []) {
    const command = entry.AlterTableCmd;
    if (command?.subtype === 'AT_AddColumn') validateAddedColumn(command);
    else if (command?.subtype === 'AT_AddConstraint') validateAddedConstraint(command);
    else
      throw new Error(
        `ALTER TABLE subtype ${command?.subtype ?? '<missing>'} is not expansion-only`
      );
  }
}

function validateStatement(rawStatement, allowedExtensions) {
  const forbidden = findNode(rawStatement, destructiveNodes);
  if (forbidden !== undefined)
    throw new Error(`${forbidden} can modify existing schema, data, code, or privileges`);
  const name = statementName(rawStatement);
  const statement = name === undefined ? undefined : rawStatement[name];
  switch (name) {
    case 'AlterTableStmt':
      validateAlterTable(statement);
      break;
    case 'CompositeTypeStmt':
    case 'CreateDomainStmt':
    case 'CreateEnumStmt':
    case 'CreateSchemaStmt':
    case 'CreateSeqStmt':
    case 'CreateStmt':
      break;
    case 'CreateExtensionStmt':
      if (
        !allowedExtensions.has(statement.extname) ||
        statement.if_not_exists !== true ||
        statement.cascade === true
      ) {
        throw new Error(
          `Extension ${statement.extname} is not an allowed idempotent standalone extension`
        );
      }
      break;
    case 'IndexStmt':
      if (statement.unique === true)
        throw new Error('Unique indexes can reject existing data or old-writer behavior');
      break;
    default:
      throw new Error(
        `${name ?? '<unknown statement>'} is not in the expansion-only structural allowlist`
      );
  }
}

async function assertExpansionOnly(entries, allowedExtensions) {
  for (const { name, sql } of entries) {
    let parsed;
    try {
      parsed = await parse(sql);
    } catch (error) {
      throw new Error(`Migration ${name} is not valid PostgreSQL SQL: ${error.message}`, {
        cause: error
      });
    }
    try {
      for (const raw of parsed.stmts ?? []) validateStatement(raw.stmt, allowedExtensions);
    } catch (error) {
      throw new Error(`Migration ${name} violates the expansion-only policy: ${error.message}`, {
        cause: error
      });
    }
  }
}

function lineage(entries) {
  let head = sha256(`${LINEAGE_DOMAIN}\0`);
  const ancestry = [];
  for (const { name, sql } of entries) {
    head = sha256(`${head}\0${name}\0${sha256(sql)}\0`);
    ancestry.push(head);
  }
  return { head, ancestry };
}

function manifestPayload(manifest) {
  const { integrity: _integrity, ...payload } = manifest;
  return payload;
}

function assertManifestIntegrity(manifest) {
  if (!/^[a-f0-9]{64}$/u.test(manifest.integrity ?? ''))
    throw new Error('Previous release manifest has invalid integrity');
  if (sha256(JSON.stringify(manifestPayload(manifest))) !== manifest.integrity) {
    throw new Error('Previous release manifest integrity mismatch');
  }
}

async function inspect(base) {
  const policy = JSON.parse(
    await readFile(path.join(base, 'deploy', 'schema-policy.json'), 'utf8')
  );
  const entries = await migrationEntries(base);
  if (policy.policy_version !== 2) throw new Error('Unsupported schema policy version');
  if (
    !Array.isArray(policy.allowed_extensions) ||
    policy.allowed_extensions.some(
      (extension) => typeof extension !== 'string' || extension.length === 0
    )
  ) {
    throw new Error('Invalid allowed_extensions');
  }
  await assertExpansionOnly(entries, new Set(policy.allowed_extensions));
  const migrationSetDigest = sha256(
    entries.map(({ name, sql }) => `${name}\0${sha256(sql)}\0`).join('')
  );
  const schemaLineage = lineage(entries);
  for (const name of ['legacy_untracked_schema_digest', 'repaired_schema_digest']) {
    if (!/^[a-f0-9]{64}$/u.test(policy[name])) throw new Error(`Invalid ${name}`);
  }
  if (policy.migration_policy !== 'expansion-only')
    throw new Error('Only expansion-only migrations are supported by routine deployment');
  for (const name of [
    'schema_generation',
    'compatible_schema_generation_min',
    'compatible_schema_generation_max'
  ]) {
    if (!Number.isSafeInteger(policy[name]) || policy[name] < 1) throw new Error(`Invalid ${name}`);
  }
  if (
    policy.compatible_schema_generation_min > policy.schema_generation ||
    policy.compatible_schema_generation_max < policy.schema_generation
  ) {
    throw new Error('The release schema generation must be inside its compatibility range');
  }
  return {
    migration_policy: policy.migration_policy,
    migration_set_digest: migrationSetDigest,
    schema_lineage_algorithm: LINEAGE_ALGORITHM,
    schema_lineage_digest: schemaLineage.head,
    schema_lineage_depth: entries.length,
    schema_generation: policy.schema_generation,
    compatible_schema_generation_min: policy.compatible_schema_generation_min,
    compatible_schema_generation_max: policy.compatible_schema_generation_max,
    legacy_untracked_schema_digest: policy.legacy_untracked_schema_digest,
    repaired_schema_digest: policy.repaired_schema_digest,
    _lineage_ancestry: schemaLineage.ancestry
  };
}

switch (command) {
  case 'inspect': {
    const { _lineage_ancestry: _ancestry, ...policy } = await inspect(root);
    process.stdout.write(`${JSON.stringify(policy)}\n`);
    break;
  }
  case 'emit-nul': {
    const { _lineage_ancestry: _ancestry, ...policy } = await inspect(root);
    for (const [name, value] of Object.entries(policy))
      process.stdout.write(`${name.toUpperCase()}\0${String(value)}\0`);
    break;
  }
  case 'rollback-compatible': {
    const [
      previousRootArgument,
      currentRootArgument,
      currentGeneration,
      currentMigrationSetDigest,
      currentLineageDigest
    ] = process.argv.slice(3);
    if (
      previousRootArgument === undefined ||
      currentRootArgument === undefined ||
      currentGeneration === undefined ||
      currentMigrationSetDigest === undefined ||
      currentLineageDigest === undefined
    ) {
      throw new Error(
        'rollback-compatible requires previous root, current root, current generation, current migration-set digest, and current lineage digest'
      );
    }
    const previousRoot = path.resolve(previousRootArgument);
    const currentPolicy = await inspect(path.resolve(currentRootArgument));
    if (
      currentPolicy.schema_generation !== Number(currentGeneration) ||
      currentPolicy.migration_set_digest !== currentMigrationSetDigest ||
      currentPolicy.schema_lineage_digest !== currentLineageDigest
    ) {
      throw new Error(
        'Current release schema arguments do not match its immutable migration lineage'
      );
    }
    const previousManifest = JSON.parse(
      await readFile(path.join(previousRoot, 'release-manifest.json'), 'utf8')
    );
    assertManifestIntegrity(previousManifest);
    if (previousManifest.manifest_version >= 2 && previousManifest.schema !== undefined) {
      const generation = Number(currentGeneration);
      if (
        generation < previousManifest.schema.compatible_generation_min ||
        generation > previousManifest.schema.compatible_generation_max
      ) {
        throw new Error(`Previous release does not support schema generation ${generation}`);
      }
      if (previousManifest.manifest_version >= 3) {
        const previousPolicy = await inspect(previousRoot);
        if (
          previousPolicy.migration_set_digest !== previousManifest.schema.migration_set_digest ||
          previousPolicy.schema_lineage_digest !== previousManifest.schema.lineage_digest ||
          previousPolicy.schema_lineage_depth !== previousManifest.schema.lineage_depth
        ) {
          throw new Error(
            'Previous release manifest does not match its immutable migration lineage'
          );
        }
        if (!currentPolicy._lineage_ancestry.includes(previousManifest.schema.lineage_digest)) {
          throw new Error(
            'Previous release schema lineage is not an ancestor of the current schema'
          );
        }
      } else if (previousManifest.schema.migration_set_digest !== currentMigrationSetDigest) {
        throw new Error(
          'Version-2 previous release has no lineage proof and its migration set differs'
        );
      }
    } else {
      const previousEntries = await migrationEntries(previousRoot);
      const previousPolicy = JSON.parse(
        await readFile(path.join(previousRoot, 'deploy', 'schema-policy.json'), 'utf8')
      );
      await assertExpansionOnly(previousEntries, new Set(previousPolicy.allowed_extensions ?? []));
      const previousDigest = sha256(
        previousEntries.map(({ name, sql }) => `${name}\0${sha256(sql)}\0`).join('')
      );
      if (previousDigest !== currentMigrationSetDigest) {
        throw new Error(
          'Legacy previous release has no declared schema lineage and its migration set differs'
        );
      }
    }
    break;
  }
  default:
    throw new Error(`Unknown schema-policy command: ${command ?? '<missing>'}`);
}
