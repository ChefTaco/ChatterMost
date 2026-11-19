/**
 * Ceilings for the WebSocket bridge. Upgrades do not pass through the HTTP rate limiter, so
 * without these one address could hold sockets open, or flood one, until the process ran out.
 */

export type SocketAdmissionLimits = {
  /** Open sockets across all clients. */
  maximum: number;
  /** Open sockets attributed to one client address. */
  maximumPerSource: number;
  /** Sockets that have not signed in yet, across all clients. */
  maximumPending?: number;
  /** Sockets that have not signed in yet, from one client address. */
  maximumPendingPerSource?: number;
};

export type SocketTicket = {
  /** Set once the connection exists, so a socket that signs in stops counting as pending. */
  signedIn: () => boolean;
  release: () => void;
};

export class SocketAdmission {
  private readonly tickets = new Map<SocketTicket, string>();
  private readonly perSource = new Map<string, number>();

  public constructor(private readonly limits: SocketAdmissionLimits) {}

  public get size(): number {
    return this.tickets.size;
  }

  /** A ticket for one new socket, or null when a ceiling is reached. */
  public admit(source: string, signedIn: boolean): SocketTicket | null {
    if (this.tickets.size >= this.limits.maximum) return null;
    if ((this.perSource.get(source) ?? 0) >= this.limits.maximumPerSource) return null;
    if (!signedIn) {
      let pending = 0;
      let pendingFromSource = 0;
      for (const [ticket, ticketSource] of this.tickets) {
        if (ticket.signedIn()) continue;
        pending += 1;
        if (ticketSource === source) pendingFromSource += 1;
      }
      if (pending >= (this.limits.maximumPending ?? 500)) return null;
      if (pendingFromSource >= (this.limits.maximumPendingPerSource ?? 20)) return null;
    }
    let released = false;
    const ticket: SocketTicket = {
      signedIn: () => signedIn,
      release: () => {
        if (released) return;
        released = true;
        this.tickets.delete(ticket);
        const remaining = (this.perSource.get(source) ?? 1) - 1;
        if (remaining <= 0) this.perSource.delete(source);
        else this.perSource.set(source, remaining);
      }
    };
    this.tickets.set(ticket, source);
    this.perSource.set(source, (this.perSource.get(source) ?? 0) + 1);
    return ticket;
  }
}

/**
 * Frames one socket may send. A signed-in client gets a generous rolling allowance; a socket
 * that has not signed in gets only the few frames a sign-in needs.
 */
export class SocketMessageBudget {
  private windowStart = 0;
  private inWindow = 0;
  private beforeSignIn = 0;

  public constructor(
    private readonly perWindow = 200,
    private readonly windowMs = 10_000,
    private readonly maximumBeforeSignIn = 10
  ) {}

  public accept(signedIn: boolean, now: number): boolean {
    if (!signedIn) {
      this.beforeSignIn += 1;
      if (this.beforeSignIn > this.maximumBeforeSignIn) return false;
    }
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.inWindow = 0;
    }
    this.inWindow += 1;
    return this.inWindow <= this.perWindow;
  }
}
