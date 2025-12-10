// ============================================================
// HEROES OF SHADY GROVE - AUDIO / MUSIC MANAGER (ES5 SAFE)
// Provides a best-effort background music player that prefers
// bundled audio files but falls back to a lightweight tone so
// initialization never crashes when audio assets are missing.
// ============================================================

function MusicManager() {
    this.audio = null;
    this.context = null;
    this.fallbackOscillator = null;
}

MusicManager.prototype._ensureContext = function () {
    if (this.context) return true;
    try {
        var AudioCtx = window.AudioContext || window.webkitAudioContext;
        this.context = AudioCtx ? new AudioCtx() : null;
    } catch (err) {
        console.warn('[Audio] Failed to create AudioContext:', err);
        this.context = null;
    }
    return !!this.context;
};

MusicManager.prototype.playBackground = function () {
    var self = this;
    var defaultTrack = 'assets/audio/music/main_theme.ogg';
    var track = defaultTrack;

    try {
        if (CONFIG && CONFIG.AUDIO && CONFIG.AUDIO.MUSIC && CONFIG.AUDIO.MUSIC.MAIN_THEME) {
            track = CONFIG.AUDIO.MUSIC.MAIN_THEME;
        }
    } catch (err) {
        // CONFIG is optional; ignore failures
    }

    try {
        var audio = new Audio();
        audio.src = track;
        audio.loop = true;
        audio.preload = 'auto';
        audio.volume = 0.35;

        audio.addEventListener('error', function () {
            console.warn('[Audio] Failed to load music track "' + track + '". Falling back to tone.');
            self._playToneFallback();
        });

        var playPromise = audio.play();
        if (playPromise && playPromise.catch) {
            playPromise.catch(function (err) {
                console.warn('[Audio] Autoplay blocked or failed (' + err + '). Using tone fallback.');
                self._playToneFallback();
            });
        }

        this.audio = audio;
    } catch (err) {
        console.warn('[Audio] Music playback unavailable. Falling back to tone.', err);
        this._playToneFallback();
    }
};

MusicManager.prototype._playToneFallback = function () {
    if (!this._ensureContext()) return;

    // Stop any existing tone first
    this.stopTone();

    try {
        var osc = this.context.createOscillator();
        var gain = this.context.createGain();
        gain.gain.value = 0.03;

        osc.type = 'sine';
        osc.frequency.value = 220;
        osc.connect(gain);
        gain.connect(this.context.destination);
        osc.start();

        this.fallbackOscillator = osc;
    } catch (err) {
        console.warn('[Audio] Tone fallback failed:', err);
    }
};

MusicManager.prototype.stopTone = function () {
    if (this.fallbackOscillator) {
        try {
            this.fallbackOscillator.stop();
            this.fallbackOscillator.disconnect();
        } catch (err) {
            // ignore stop errors
        }
        this.fallbackOscillator = null;
    }
};

MusicManager.prototype.stop = function () {
    if (this.audio) {
        try {
            this.audio.pause();
        } catch (err) {
            // ignore
        }
        this.audio = null;
    }
    this.stopTone();
};

window.MusicManager = MusicManager;
