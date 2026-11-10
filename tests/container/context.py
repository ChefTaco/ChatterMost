#!/usr/bin/env python3
"""Export the actual Docker context and reject any unapproved build inputs."""
from pathlib import Path
import shutil
import subprocess
import tempfile

sentinels = [Path('deploy/context-private-sentinel'), Path('src/.env.context-private-sentinel')]
work = Path(tempfile.mkdtemp(prefix='chattermost-context-'))
created = []
try:
    for file in sentinels:
        if file.exists():
            raise RuntimeError('Context sentinel already exists; refusing replacement')
        file.write_text('synthetic excluded context sentinel\n')
        created.append(file)
    result = subprocess.run(['docker', 'buildx', 'build', '-f', '-', '--output', f'type=local,dest={work}', '.'], input=b'FROM scratch\nCOPY . /\n', stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError('Docker context audit export failed')
    files = {p.relative_to(work).as_posix() for p in work.rglob('*') if p.is_file()}
    exact = {'package.json', 'package-lock.json', 'tsconfig.json', 'LICENSE', 'NOTICE', 'deploy/Dockerfile', 'deploy/schema-policy.json', 'prisma/schema.prisma', 'scripts/container.ts', 'scripts/probe-tls.ts', 'scripts/image-notices.ts', 'scripts/schema-policy.mjs'}
    assert exact <= files
    assert not {f for f in files if f not in exact and not f.startswith(('src/', 'prisma/migrations/'))}
    assert not any('sentinel' in f for f in files)
    print(f'Actual Docker build context privacy: passed ({len(files)} approved inputs)')
finally:
    for file in created:
        file.unlink(missing_ok=True)
    shutil.rmtree(work)
