window.AudioContext = window.AudioContext || window.webkitAudioContext;

export function ensureAudioContext() {
    if (window.__rs2b0tDisableAudio || !window.AudioContext) {
        return null;
    }
    if (!window.audioContext) {
        window.audioContext = new window.AudioContext({ sampleRate: 22050 });
    }
    return window.audioContext;
}

// Fix iOS Audio Context by Blake Kus https://gist.github.com/kus/3f01d60569eeadefe3a1
// MIT license
(function () {
    var fixAudioContext = function (e) {
        const audioContext = ensureAudioContext();
        if (audioContext) {
            // Create empty buffer
            var buffer = audioContext.createBuffer(1, 1, 22050);
            var source = audioContext.createBufferSource();
            source.buffer = buffer;
            // Connect to output (speakers)
            source.connect(audioContext.destination);
            // Play sound
            if (source.start) {
                source.start(0);
            } else if (source.play) {
                source.play(0);
            } else if (source.noteOn) {
                source.noteOn(0);
            }
        }
        // Remove events
        document.removeEventListener('touchstart', fixAudioContext);
        document.removeEventListener('touchend', fixAudioContext);
        document.removeEventListener('click', fixAudioContext);
    };
    // iOS 6-8
    document.addEventListener('touchstart', fixAudioContext);
    // iOS 9
    document.addEventListener('touchend', fixAudioContext);
    // Safari
    document.addEventListener('click', fixAudioContext);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            if (window.audioContext) {
                window.audioContext.resume();
            }
        }
    });
})();

let waveGain;

export async function playWave(data) {
    try {
        const audioContext = ensureAudioContext();
        if (!audioContext) {
            return;
        }
        const audioBuffer = await audioContext.decodeAudioData(new Uint8Array(data).buffer);
        let bufferSource = audioContext.createBufferSource();
        bufferSource.buffer = audioBuffer;
        bufferSource.connect(waveGain);
        bufferSource.start();
    } catch (e) {
        console.error(e);
    }
}

export function setWaveVolume(dB) {
    const audioContext = ensureAudioContext();
    if (!audioContext) {
        return;
    }
    if (!waveGain) {
        waveGain = audioContext.createGain();
        waveGain.connect(audioContext.destination);
    }

    waveGain.gain.value = Math.pow(10, dB / 20);
}
