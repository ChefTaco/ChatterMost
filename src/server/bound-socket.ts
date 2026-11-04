import { parse as parseCookie } from 'cookie';
import { isSameWebSocketOrigin } from './security.js';

export async function authenticateSocketUpgrade<T>(
  headers: {
    authorization?: string | undefined;
    cookie?: string | undefined;
    origin?: string | undefined;
  },
  serverUrl: string,
  cookieName: string,
  authenticate: (token: string) => Promise<T | null>,
  allowedOrigins: readonly string[] = []
): Promise<T | null> {
  if (headers.authorization !== undefined) {
    const bearer = /^Bearer\s+(.+)$/iu.exec(headers.authorization)?.[1];
    return bearer === undefined ? null : authenticate(bearer);
  }
  if (
    !headers.cookie ||
    !(
      isSameWebSocketOrigin(headers.origin, serverUrl) ||
      (headers.origin !== undefined && allowedOrigins.includes(headers.origin))
    )
  )
    return null;
  const cookies = parseCookie(headers.cookie);
  const token = cookies[cookieName] ?? cookies.MMSID;
  return token === undefined ? null : authenticate(token);
}

/** Coalesce identity checks during a burst without caching an authorization. */
export function guardedSocketSender(
  socket: { send: (payload: string) => void; close: (code: number, reason: string) => void },
  validate: () => Promise<boolean>,
  maximumPending = 100
): (payload: string) => void {
  let active: Promise<boolean> | undefined;
  let pending = 0;
  let closed = false;
  return (payload) => {
    if (closed) return;
    if (pending >= maximumPending) {
      closed = true;
      socket.close(1013, 'Session validation overloaded');
      return;
    }
    pending++;
    active ??= validate()
      .catch(() => false)
      .finally(() => {
        active = undefined;
      });
    void active
      .then((allowed) => {
        if (closed) return;
        if (!allowed) {
          closed = true;
          socket.close(1008, 'Session expired');
          return;
        }
        socket.send(payload);
      })
      .catch(() => {
        if (!closed) {
          closed = true;
          socket.close(1011, 'WebSocket send failed');
        }
      })
      .finally(() => {
        pending--;
      });
  };
}
