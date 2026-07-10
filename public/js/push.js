const Push = {
  registration: null,
  supported: 'serviceWorker' in navigator && 'PushManager' in window,

  async init() {
    if (!this.supported) return;
    try {
      this.registration = await navigator.serviceWorker.register('/sw.js');
    } catch (err) {
      this.supported = false;
    }
  },

  async isSubscribed() {
    if (!this.supported || !this.registration) return false;
    const sub = await this.registration.pushManager.getSubscription();
    return !!sub;
  },

  async enable() {
    if (!this.supported) throw new Error('Push notifications are not supported in this browser');
    if (Notification.permission === 'denied') {
      throw new Error('Notifications are blocked for this site in your browser settings');
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notification permission was not granted');

    const { publicKey } = await API.get('/api/push/vapid-public-key');
    const sub = await this.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });
    await API.post('/api/push/subscribe', { subscription: sub.toJSON() });
    return true;
  },

  async disable() {
    if (!this.registration) return;
    const sub = await this.registration.pushManager.getSubscription();
    if (sub) {
      await API.post('/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
      await sub.unsubscribe();
    }
  }
};

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}
