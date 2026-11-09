/* Mod: Interconectar playlists (P2P, código de sala personalizado, 100% Offline / Local)
   Archivo: mods/interconectar-playlists.js
*/
(function () {
  var peer = null;
  var conn = null;
  var role = null;
  var audioWired = false;
  var creating = false;
  var hostInterval = null;

  function $(id) { return document.getElementById(id); }

  function getAssetUrl(filename) {
    if (window.ModAPI && typeof window.ModAPI.getAssetUrl === "function") {
      return window.ModAPI.getAssetUrl(filename);
    }
    return "mods/assets/" + filename;
  }

  function setStatus(msg) {
    var el = $("p2p-status");
    if (el) el.textContent = msg;
    try { console.log("[Listas P2P]", msg); } catch (e) {}
    updateStreamButtonState();
  }

  function setCode(id) {
    var input = $("p2p-code");
    if (input) input.value = id || "";
    var vis = $("p2p-code-visible");
    if (vis) vis.textContent = id || "(sin código)";
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var prev = document.querySelector('script[data-p2p-peerjs="1"][src="' + src + '"]');
      if (prev && window.Peer) return resolve(src);
      var s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.setAttribute("data-p2p-peerjs", "1");
      s.onload = function () { resolve(src); };
      s.onerror = function () { reject(new Error("No se pudo cargar el asset local: " + src)); };
      document.head.appendChild(s);
    });
  }

  function ensurePeerJs() {
    if (typeof window.Peer === "function") {
      return Promise.resolve("memoria");
    }
    var localAssetPath = getAssetUrl("peerjs.min.js");
    
    return loadScript(localAssetPath)
      .then(function (src) {
        if (typeof window.Peer !== "function") {
          throw new Error("El archivo cargó pero Peer não está definido.");
        }
        setStatus("PeerJS Local OK (" + src + ")");
        return src;
      });
  }

  function getAudio() {
    return document.getElementById("audio-player");
  }

  function normUrl(u) {
    return String(u || "").trim().split("#")[0].split("?")[0];
  }

  function currentTrackPayload(type) {
    var audio = getAudio();
    var titleEl = document.getElementById("footer-title");
    var artistEl = document.getElementById("footer-sub");
    var src = audio ? (audio.currentSrc || audio.src || "") : "";
    var song = window.currentSong || {};
    var url = song.url_final || song.path || song.download_url || src;
    return {
      type: type || "track",
      url: url,
      titulo: song.titulo || song.name || (titleEl ? titleEl.innerText : "") || "",
      artista: song.artista || song.artist || (artistEl ? artistEl.innerText : "") || "",
      playing: !!(audio && !audio.paused && !audio.ended),
      t: audio ? (audio.currentTime || 0) : 0
    };
  }

  function applyTrack(data) {
    if (role !== "guest" || !data || !data.url) return;
    var audio = getAudio();
    if (!audio) return;

    var want = normUrl(data.url);
    var cur = normUrl(audio.currentSrc || audio.src || "");
    var same = cur && want && (cur === want || cur.indexOf(want) !== -1 || want.indexOf(cur) !== -1);

    if (!same) {
      try {
        audio.src = data.url;
        audio.load();
        var ft = document.getElementById("footer-title");
        var fs = document.getElementById("footer-sub");
        if (ft && data.titulo) ft.textContent = data.titulo;
        if (fs && data.artista) fs.textContent = data.artista;
        var done = false;
        var finish = function () {
          if (done) return;
          done = true;
          try { audio.removeEventListener("loadedmetadata", finish); } catch (e) {}
          if (typeof data.t === "number" && data.t > 0) {
            try { audio.currentTime = data.t; } catch (e) {}
          }
          if (data.playing && audio.paused) {
            audio.play().catch(function () {});
          } else if (!data.playing && !audio.paused) {
            audio.pause();
          }
        };
        audio.addEventListener("loadedmetadata", finish);
        setTimeout(finish, 1500);
      } catch (e) {}
      return;
    }

    if (typeof data.t === "number") {
      var diff = Math.abs((audio.currentTime || 0) - data.t);
      if (diff > 1.2) {
        try { audio.currentTime = data.t; } catch (e) {}
      }
    }

    var shouldPlay = !!data.playing;
    var isPlaying = !audio.paused && !audio.ended;
    if (shouldPlay && !isPlaying && audio.paused) {
      audio.play().catch(function () {});
    } else if (!shouldPlay && isPlaying) {
      audio.pause();
    }
  }

  function send(data) {
    if (conn && conn.open) {
      try { conn.send(data); } catch (e) {}
    }
  }

  function broadcastIfHost(forceType) {
    if (role !== "host" || !conn || !conn.open) return;
    var p = currentTrackPayload(forceType || "track");
    if (!p.url) return;
    send(p);
  }

  function wireHostAudioEvents() {
    if (audioWired) return;
    var audio = getAudio();
    if (!audio) return;
    audioWired = true;

    ["play", "pause", "seeked"].forEach(function (ev) {
      audio.addEventListener(ev, function () {
        setTimeout(function () { broadcastIfHost("track"); }, 50);
      });
    });

    if (hostInterval) clearInterval(hostInterval);
    hostInterval = setInterval(function () {
      if (role === "host" && conn && conn.open) {
        broadcastIfHost("transport");
      }
    }, 1000);
  }

  function updateStreamButtonState() {
    var btn = $("open-p2p-modal-btn");
    var indicator = $("p2p-stream-indicator");
    var text = $("p2p-stream-text");
    if (!btn) return;

    if (role === "host") {
      btn.classList.add("is-streaming");
      if (indicator) indicator.className = "stream-dot live";
      if (text) text.textContent = "Transmitiendo";
    } else if (role === "guest") {
      btn.classList.add("is-streaming");
      if (indicator) indicator.className = "stream-dot connected";
      if (text) text.textContent = "Escuchando";
    } else {
      btn.classList.remove("is-streaming");
      if (indicator) indicator.className = "stream-dot idle";
      if (text) text.textContent = "Live P2P";
    }
  }

  function wireConnection(c) {
    conn = c;
    c.on("open", function () {
      setStatus(role === "host" ? "Alguien se unió. Eres el DJ." : "Conectado. Escuchando al DJ.");
      updateStreamButtonState();
      if (role === "host") {
        broadcastIfHost("track");
        wireHostAudioEvents();
      }
    });
    c.on("data", function (data) {
      if (!data || !data.type) return;
      if (data.type === "track" || data.type === "transport") {
        applyTrack(data);
      }
      if (data.type === "playlist" && role === "guest") {
        setStatus("Lista recibida (" + (data.songs && data.songs.length) + ").");
      }
    });
    c.on("close", function () {
      setStatus("Conexión cerrada.");
      conn = null;
      if (hostInterval) { clearInterval(hostInterval); hostInterval = null; }
      updateStreamButtonState();
    });
    c.on("error", function (err) {
      setStatus("Error de conexión: " + (err && (err.type || err.message) || "?"));
      updateStreamButtonState();
    });
  }

  function destroyPeer() {
    if (hostInterval) { clearInterval(hostInterval); hostInterval = null; }
    try { if (conn) conn.close(); } catch (e) {}
    conn = null;
    try { if (peer) peer.destroy(); } catch (e) {}
    peer = null;
    audioWired = false;
    updateStreamButtonState();
  }

  function cerrarSala() {
    destroyPeer();
    role = null;
    setCode("");
    setStatus("Sala cerrada.");
  }

  function desconectarse() {
    destroyPeer();
    role = null;
    setStatus("Desconectado de la sala.");
  }

  function newPeerInstance(customId) {
    return new window.Peer(customId || undefined, {
      host: "0.peerjs.com",
      port: 443,
      path: "/",
      secure: true,
      debug: 2,
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" }
        ]
      }
    });
  }

  function crearSala() {
    if (creating) {
      setStatus("Ya se está creando la sala…");
      return;
    }
    
    // Leemos el código personalizado que hayas escrito en el input (si está vacío, pasa undefined para que se genere solo)
    var customCodeInput = $("p2p-custom-code-input");
    var desiredId = customCodeInput ? customCodeInput.value.trim() : "";

    creating = true;
    setStatus("1/3 Cargando PeerJS local…");

    ensurePeerJs()
      .then(function () {
        setStatus("2/3 Conectando al señalizador…");
        destroyPeer();
        role = "host";

        // Pasamos tu código personalizado a la instancia de Peer
        peer = newPeerInstance(desiredId ? desiredId : undefined);
        var opened = false;

        peer.on("open", function (id) {
          opened = true;
          creating = false;
          setCode(id);
          setStatus("3/3 Sala lista con código: " + id);
          updateStreamButtonState();
        });

        peer.on("connection", function (c) { wireConnection(c); });

        peer.on("disconnected", function () {
          setStatus("Peer desconectado. Reintentando…");
          try { peer.reconnect(); } catch (e) {}
        });

        peer.on("error", function (err) {
          creating = false;
          var t = (err && (err.type || err.message)) || "desconocido";
          if (t === "unavailable-id") {
            setStatus("Error: Ese código de sala ya está en uso. Elige otro.");
          } else {
            setStatus("Error Peer: " + t);
          }
        });

        setTimeout(function () {
          if (!opened) {
            creating = false;
            setStatus("Tiempo agotado: señalizador no respondió.");
          }
        }, 12000);
      })
      .catch(function (e) {
        creating = false;
        setStatus("Fallo: " + (e && e.message ? e.message : e));
      });
  }

  function unirse() {
    var code = ($("p2p-join-code") && $("p2p-join-code").value || "").trim();
    if (!code) {
      setStatus("Escribe el código de la sala.");
      return;
    }
    setStatus("Cargando PeerJS local…");
    ensurePeerJs()
      .then(function () {
        destroyPeer();
        role = "guest";
        setStatus("Conectando…");
        peer = newPeerInstance();
        peer.on("open", function () {
          var c = peer.connect(code, { reliable: true });
          wireConnection(c);
          setStatus("Esperando al DJ…");
        });
        peer.on("error", function (err) {
          setStatus("Error Peer: " + (err && (err.type || err.message) || "?"));
        });
      })
      .catch(function (e) {
        setStatus("Fallo: " + (e && e.message ? e.message : e));
      });
  }

  function enviarListaActual() {
    if (role !== "host") {
      setStatus("Solo el DJ puede enviar la lista.");
      return;
    }
    var name = window.currentPlaylistName;
    var songs = (name && window.userPlaylists && window.userPlaylists[name]) || [];
    send({ type: "playlist", name: name || "", songs: songs });
    broadcastIfHost("track");
    setStatus("Lista / tema enviados (" + songs.length + ").");
  }

  function copiarCodigo() {
    var v = ($("p2p-code") && $("p2p-code").value) || "";
    if (!v) {
      setStatus("No hay código aún. Pulsa Crear sala.");
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(v).then(function () {
        setStatus("Código copiado.");
      }).catch(function () {
        setStatus("No se pudo copiar; selecciónalo a mano.");
      });
    } else {
      setStatus("Copia el código a mano.");
    }
  }

  function initMod() {
    if (!document.getElementById("p2p-custom-styles")) {
      var styleTag = document.createElement("style");
      styleTag.id = "p2p-custom-styles";
      styleTag.innerHTML = [
        '.player-bar-stream-btn {',
        '  background: rgba(15, 23, 42, 0.6);',
        '  border: 1px solid rgba(255, 255, 255, 0.15);',
        '  color: #f8fafc;',
        '  padding: 6px 12px;',
        '  border-radius: 20px;',
        '  cursor: pointer;',
        '  font-size: 12px;',
        '  font-weight: 600;',
        '  display: inline-flex;',
        '  align-items: center;',
        '  gap: 8px;',
        '  transition: all 0.2s ease;',
        '  margin-right: 8px;',
        '  box-shadow: 0 2px 5px rgba(0,0,0,0.2);',
        '}',
        '.player-bar-stream-btn:hover {',
        '  background: rgba(30, 41, 59, 0.9);',
        '  border-color: rgba(255, 255, 255, 0.35);',
        '}',
        '.player-bar-stream-btn.is-streaming {',
        '  border-color: #ef4444;',
        '  background: rgba(239, 68, 68, 0.12);',
        '}',
        '.stream-dot {',
        '  width: 8px;',
        '  height: 8px;',
        '  border-radius: 50%;',
        '  display: inline-block;',
        '}',
        '.stream-dot.idle { background: #94a3b8; }',
        '.stream-dot.live { background: #ef4444; box-shadow: 0 0 8px #ef4444; animation: pulse-live 1.5s infinite; }',
        '.stream-dot.connected { background: #10b981; box-shadow: 0 0 8px #10b981; }',
        '@keyframes pulse-live {',
        '  0% { transform: scale(0.95); opacity: 0.8; }',
        '  50% { transform: scale(1.25); opacity: 1; }',
        '  100% { transform: scale(0.95); opacity: 0.8; }',
        '}',
        '.p2p-modal-overlay {',
        '  position: fixed;',
        '  top: 0;',
        '  left: 0;',
        '  width: 100vw;',
        '  height: 100vh;',
        '  background: rgba(15, 23, 42, 0.8);',
        '  backdrop-filter: blur(4px);',
        '  display: flex;',
        '  justify-content: center;',
        '  align-items: center;',
        '  z-index: 99999;',
        '  opacity: 1;',
        '  transition: opacity 0.2s ease;',
        '}',
        '.p2p-modal-overlay.hidden {',
        '  display: none !important;',
        '  opacity: 0;',
        '}',
        '.p2p-modal-content {',
        '  background: #1e293b;',
        '  color: #f8fafc;',
        '  width: 380px;',
        '  max-width: 90%;',
        '  max-height: 90vh;',
        '  overflow-y: auto;',
        '  padding: 20px;',
        '  border-radius: 12px;',
        '  border: 1px solid #334155;',
        '  box-shadow: 0 10px 25px rgba(0,0,0,0.5);',
        '}',
        '.p2p-modal-header {',
        '  display: flex;',
        '  justify-content: space-between;',
        '  align-items: center;',
        '  margin-bottom: 15px;',
        '  border-bottom: 1px solid #334155;',
        '  padding-bottom: 10px;',
        '}',
        '.p2p-close-btn {',
        '  background: none;',
        '  border: none;',
        '  color: #94a3b8;',
        '  font-size: 22px;',
        '  cursor: pointer;',
        '}',
        '.p2p-close-btn:hover {',
        '  color: #fff;',
        '}'
      ].join("\n");
      document.head.appendChild(styleTag);
    }

    if (!document.getElementById("p2p-modal-overlay")) {
      var modalContainer = document.createElement("div");
      modalContainer.innerHTML = [
        '<div id="p2p-modal-overlay" class="p2p-modal-overlay hidden">',
        '  <div class="p2p-modal-content">',
        '    <div class="p2p-modal-header">',
        '      <h3 class="text-base font-bold text-white">Panel de Transmisión P2P</h3>',
        '      <button type="button" id="p2p-btn-close-modal" class="p2p-close-btn">&times;</button>',
        '    </div>',
        '    <div class="p2p-modal-body space-y-3">',
        '      <p class="text-xs text-slate-400">Sin Firebase. Conecta tu sesión localmente.</p>',
        '      <div class="rounded-lg border border-gray-700 p-3 bg-[#0f172a]">',
        '        <p class="text-sm font-bold text-white mb-2">Crear transmisión (DJ)</p>',
        '        <label class="block text-xs text-slate-400 mb-1">Escribe tu código personalizado (opcional)</label>',
        '        <input id="p2p-custom-code-input" class="w-full bg-[#1e293b] text-white text-xs p-2 rounded border border-gray-600 mb-2" placeholder="Ej: mi-sala-angelito (vacío = automático)"/>',
        '        <button type="button" id="p2p-btn-host" class="w-full py-2 rounded-lg bg-indigo-600 text-white text-sm font-bold">Iniciar Transmisión</button>',
        '        <label class="block text-xs text-slate-400 mt-2">Código de Sala Activo</label>',
        '        <input id="p2p-code" readonly class="w-full mt-1 bg-[#1e293b] text-white text-xs p-2 rounded border border-gray-600" placeholder="Se genera al iniciar…"/>',
        '        <p class="text-[11px] text-slate-300 mt-1 break-all">Visible: <span id="p2p-code-visible">(sin código)</span></p>',
        '        <button type="button" id="p2p-btn-copy" class="w-full mt-2 py-1.5 rounded-lg bg-slate-600 text-white text-xs">Copiar código</button>',
        '        <button type="button" id="p2p-btn-close" class="w-full mt-2 py-2 rounded-lg bg-red-600 text-white text-sm font-bold">Cerrar transmisión</button>',
        '      </div>',
        '      <div class="rounded-lg border border-gray-700 p-3 bg-[#0f172a]">',
        '        <p class="text-sm font-bold text-white mb-2">Unirse a transmisión</p>',
        '        <input id="p2p-join-code" class="w-full bg-[#1e293b] text-white text-xs p-2 rounded border border-gray-600" placeholder="Pega el código del DJ"/>',
        '        <button type="button" id="p2p-btn-join" class="w-full mt-2 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold">Conectar</button>',
        '        <button type="button" id="p2p-btn-disconnect" class="w-full mt-2 py-2 rounded-lg bg-rose-600 text-white text-sm font-bold">Desconectarse</button>',
        '      </div>',
        '      <button type="button" id="p2p-btn-send-pl" class="w-full py-2 rounded-lg bg-slate-700 text-white text-sm">Enviar lista actual (DJ)</button>',
        '      <p id="p2p-status" class="text-xs text-indigo-300">Listo. Configura tu sesión.</p>',
        '    </div>',
        '  </div>',
        '</div>'
      ].join("\n");
      document.body.appendChild(modalContainer);
    }

    function injectPlayerButton() {
      var lyricsBtn = document.getElementById("btn-mod-lyrics");
      if (lyricsBtn && !document.getElementById("open-p2p-modal-btn")) {
        var btn = document.createElement("button");
        btn.id = "open-p2p-modal-btn";
        btn.className = "player-bar-stream-btn";
        btn.innerHTML = '<span id="p2p-stream-indicator" class="stream-dot idle"></span><span id="p2p-stream-text">Live P2P</span>';
        btn.title = "Abrir panel de transmisión";
        
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          var modal = $("p2p-modal-overlay");
          if (modal) modal.classList.remove("hidden");
        });

        lyricsBtn.parentNode.insertBefore(btn, lyricsBtn);
      } else if (!lyricsBtn) {
        setTimeout(injectPlayerButton, 500);
      }
    }
    injectPlayerButton();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMod);
  } else {
    initMod();
  }

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.id) return;

    if (t.id === "p2p-btn-close-modal" || t.id === "p2p-modal-overlay") {
      if (t.id === "p2p-modal-overlay" && e.target !== $("p2p-modal-overlay")) return;
      var modal = $("p2p-modal-overlay");
      if (modal) modal.classList.add("hidden");
    } else if (t.id === "p2p-btn-host") {
      e.preventDefault();
      crearSala();
    } else if (t.id === "p2p-btn-join") {
      e.preventDefault();
      unirse();
    } else if (t.id === "p2p-btn-send-pl") {
      e.preventDefault();
      enviarListaActual();
    } else if (t.id === "p2p-btn-copy") {
      e.preventDefault();
      copiarCodigo();
    } else if (t.id === "p2p-btn-close") {
      e.preventDefault();
      cerrarSala();
    } else if (t.id === "p2p-btn-disconnect") {
      e.preventDefault();
      desconectarse();
    }
  }, true);
})();