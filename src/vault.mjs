// Internal-only Durable Object. The Worker addresses one random flow or session per object.
const empty = (status = 204) => new Response(null, { status });

export class AuthVault {
  constructor(state) {
    this.storage = state.storage;
  }

  async fetch(request) {
    const action = new URL(request.url).pathname;
    if (action === '/create' && request.method === 'POST') {
      const record = await request.json();
      await Promise.all([this.storage.put('record', record), this.storage.setAlarm(record.expires)]);
      return empty();
    }
    if (action === '/clear' && request.method === 'POST') {
      await this.storage.deleteAll();
      await this.storage.deleteAlarm();
      return empty();
    }
    if (action === '/consume' && request.method === 'POST') {
      const { state } = await request.json();
      const record = await this.storage.transaction(async (tx) => {
        const value = await tx.get('record');
        if (!value || value.kind !== 'flow' || value.expires <= Date.now() || value.state !== state)
          return null;
        await tx.delete('record');
        return value;
      });
      if (!record) return empty(404);
      await this.storage.deleteAlarm();
      return Response.json(record);
    }
    if (action === '/session' && request.method === 'GET') {
      const value = await this.storage.get('record');
      if (value?.kind === 'session' && value.expires > Date.now()) return Response.json(value.user);
    }
    return empty(404);
  }

  async alarm() {
    await this.storage.deleteAll();
  }
}
