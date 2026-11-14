/** The abort reason when a client goes away before its response is sent. Not a server fault. */
export class ClientDisconnectedError extends Error {
  constructor() {
    super('client disconnected');
    this.name = 'ClientDisconnectedError';
  }
}
