class DiscordPresence {
  constructor(clientId) {
    this.clientId = clientId;
    this.client = null;
    this.ready = false;
    this.currentActivity = null;
    this.retryTimer = null;
    this.stopped = false;
  }

  setClientId(clientId) {
    if (clientId === this.clientId) return;
    this.clientId = clientId;
    this.disconnect();
    if (clientId) this.connect();
  }

  connect() {
    if (!this.clientId || this.client) return;
    this.stopped = false;

    let Client;
    try {
      ({ Client } = require('@xhayper/discord-rpc'));
    } catch {
      return;
    }

    this.client = new Client({ clientId: this.clientId });

    this.client.on('ready', () => {
      this.ready = true;
      this._push();
    });
    this.client.on('disconnected', () => {
      this.ready = false;
      this._scheduleRetry();
    });

    this.client.login().catch(() => this._scheduleRetry());
  }

  _scheduleRetry() {
    if (this.stopped || this.retryTimer || !this.clientId) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this._reset();
      this.connect();
    }, 15000);
  }

  _reset() {
    if (this.client) {
      try {
        this.client.destroy();
      } catch {
      }
    }
    this.client = null;
    this.ready = false;
  }

  _push() {
    if (!this.ready || !this.client || !this.client.user) return;
    const onError = (err) => {
      if (process.argv.includes('--dev')) {
        console.error('[discord] setActivity rejected:', err && err.message);
      }
    };
    try {
      const p = this.currentActivity
        ? this.client.user.setActivity(this.currentActivity)
        : this.client.user.clearActivity();
      if (p && typeof p.catch === 'function') p.catch(onError);
    } catch (err) {
      onError(err);
    }
  }

  update(activity) {
    this.currentActivity = activity;
    this._push();
  }

  clear() {
    this.update(null);
  }

  disconnect() {
    this.stopped = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this._reset();
  }
}

module.exports = { DiscordPresence };
