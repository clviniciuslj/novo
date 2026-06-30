importScripts("https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDum7FyxneVNe3JQkmxuTbxCMpJSJscwvM",
  authDomain: "controle-laranjeiras.firebaseapp.com",
  databaseURL: "https://controle-laranjeiras-default-rtdb.firebaseio.com",
  projectId: "controle-laranjeiras",
  storageBucket: "controle-laranjeiras.firebasestorage.app",
  messagingSenderId: "884128857219",
  appId: "1:884128857219:web:55853e8408c910f0b9afb6"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "Laranjeiras Admin";
  const options = { body: payload.notification?.body || "", icon: "icons/icon-192.png" };
  self.registration.showNotification(title, options);
});

const CACHE = "laranjeiras-admin-v4";
const ASSETS = ["./index.html", "./admin.css", "./admin.js", "./firebase-config.js", "./manifest.json", "./icon-admin.png", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Network-first: sempre busca a versão mais nova online; só usa o cache como
// fallback quando o dispositivo está offline. Evita servir telas desatualizadas
// depois de um deploy novo.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
