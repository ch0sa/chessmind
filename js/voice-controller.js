/**
 * @module voice-controller
 * Handles speech-to-text (STT) and text-to-speech (TTS) for the ChessMind app.
 */

import { parseSpokenMove, formatMoveForSpeech } from './move-parser.js';

// Internal state
let recognition = null;
const synthesis = window.speechSynthesis;
let isCurrentlyListening = false;
let shouldBeListening = false;
let ttsEnabled = true;
let preferredVoice = null;
let speechRate = 1.0;
let currentStatus = 'idle';

// Callbacks
let onMoveRecognizedCallback = null;
let onCommandRecognizedCallback = null;
let onSetupCommandCallback = null;
let onErrorCallback = null;
let onStatusChangeCallback = null;
let onTranscriptCallback = null;

/**
 * Updates the current status and notifies the listener.
 * @param {string} status - The new status ('idle', 'listening', 'processing', 'speaking', 'error')
 */
function setStatus(status) {
    currentStatus = status;
    if (onStatusChangeCallback) {
        onStatusChangeCallback(status);
    }
}

/**
 * Splits text into chunks by sentences to avoid Chrome's TTS bug where it stops after ~15 seconds.
 * @param {string} text - The text to split.
 * @returns {string[]} An array of text chunks.
 */
function chunkText(text) {
    if (text.length <= 200) return [text];
    
    // Split by sentence endings
    const chunks = text.match(/[^.!?]+[.!?]+/g) || [];
    if (chunks.length === 0) {
        // Fallback if no sentence endings found
        const parts = [];
        let currentPart = '';
        const words = text.split(' ');
        
        for (const word of words) {
            if (currentPart.length + word.length > 150) {
                parts.push(currentPart.trim());
                currentPart = '';
            }
            currentPart += word + ' ';
        }
        if (currentPart) parts.push(currentPart.trim());
        return parts;
    }
    return chunks;
}

/**
 * Initialize the voice controller with options and callbacks.
 * @param {Object} options 
 * @param {Function} [options.onMoveRecognized]
 * @param {Function} [options.onCommandRecognized]
 * @param {Function} [options.onSetupCommand]
 * @param {Function} [options.onError]
 * @param {Function} [options.onStatusChange]
 * @param {Function} [options.onTranscript]
 * @returns {Object} Object indicating support for STT and TTS
 */
export function initVoice(options = {}) {
    onMoveRecognizedCallback = options.onMoveRecognized || null;
    onCommandRecognizedCallback = options.onCommandRecognized || null;
    onSetupCommandCallback = options.onSetupCommand || null;
    onErrorCallback = options.onError || null;
    onStatusChangeCallback = options.onStatusChange || null;
    onTranscriptCallback = options.onTranscript || null;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const sttSupported = !!SpeechRecognition;
    const ttsSupported = !!synthesis;
    
    if (sttSupported) {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
            isCurrentlyListening = true;
            setStatus('listening');
        };

        recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }

            if (interimTranscript && onTranscriptCallback) {
                onTranscriptCallback(interimTranscript, false);
            }

            if (finalTranscript) {
                if (onTranscriptCallback) {
                    onTranscriptCallback(finalTranscript, true);
                }
                
                setStatus('processing');
                
                // Parse the spoken text
                const parsedResult = parseSpokenMove(finalTranscript.trim());
                
                if (parsedResult) {
                    if (parsedResult.type === 'move' && onMoveRecognizedCallback) {
                        onMoveRecognizedCallback(parsedResult.san, parsedResult.from, parsedResult.to, parsedResult.promotion, parsedResult);
                    } else if (parsedResult.type === 'command' && onCommandRecognizedCallback) {
                        onCommandRecognizedCallback(parsedResult.command, parsedResult);
                    } else if ((parsedResult.type === 'setup' || parsedResult.type === 'placement' || parsedResult.type === 'remove') && onSetupCommandCallback) {
                        onSetupCommandCallback(parsedResult.action, parsedResult);
                    } else if (parsedResult.type === 'unknown' && options.onUnknown) {
                        options.onUnknown(parsedResult.raw);
                    }
                }
                
                // Return to listening state after processing
                if (shouldBeListening) {
                    setStatus('listening');
                }
            }
        };

        recognition.onerror = (event) => {
            if (event.error === 'no-speech') {
                // Ignore, will auto-restart if continuous
                return;
            }
            
            isCurrentlyListening = false;
            setStatus('error');
            
            let errorMessage = `Speech recognition error: ${event.error}`;
            if (event.error === 'audio-capture') {
                errorMessage = 'No microphone was found. Ensure that a microphone is installed and that microphone settings are configured correctly.';
            } else if (event.error === 'not-allowed') {
                errorMessage = 'Permission to use microphone is blocked. Please allow microphone access.';
            }
            
            if (onErrorCallback) {
                onErrorCallback(errorMessage, event.error);
            }
        };

        recognition.onend = () => {
            isCurrentlyListening = false;
            
            // Auto-restart if we're supposed to be listening
            if (shouldBeListening && currentStatus !== 'error') {
                try {
                    recognition.start();
                } catch (e) {
                    console.error('Failed to restart speech recognition:', e);
                    setStatus('error');
                }
            } else if (!shouldBeListening) {
                setStatus('idle');
            }
        };
    }

    // Attempt to load voices early
    if (ttsSupported) {
        // In some browsers, voices are loaded asynchronously
        window.speechSynthesis.onvoiceschanged = () => {
            getAvailableVoices(); // Force load
        };
    }
    
    // Check HTTPS warning for STT
    if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        if (onErrorCallback) {
            onErrorCallback('Microphone access typically requires HTTPS. Speech recognition may fail.', 'https-required');
        }
    }

    return {
        supported: sttSupported || ttsSupported,
        sttSupported,
        ttsSupported
    };
}

/**
 * Starts listening for speech.
 * @returns {boolean} True if successful, false otherwise.
 */
export function startListening() {
    if (!recognition) return false;
    
    shouldBeListening = true;
    
    if (!isCurrentlyListening) {
        try {
            recognition.start();
            return true;
        } catch (e) {
            console.error('Error starting recognition:', e);
            setStatus('error');
            return false;
        }
    }
    return true;
}

/**
 * Stops listening for speech.
 */
export function stopListening() {
    shouldBeListening = false;
    if (recognition && isCurrentlyListening) {
        recognition.stop();
    }
    if (currentStatus !== 'idle') {
        setStatus('idle');
    }
}

/**
 * Checks if the voice controller is currently listening.
 * @returns {boolean}
 */
export function isListening() {
    return isCurrentlyListening;
}

/**
 * Starts Push-To-Talk recording (single utterance).
 */
export function startPushToTalk() {
    if (!recognition) return false;
    shouldBeListening = true;

    const beginRecognition = () => {
        try {
            recognition.continuous = false;
            recognition.start();
            return true;
        } catch (e) {
            // Already started or starting
            if (e.name !== 'InvalidStateError') {
                console.warn('PTT start error:', e);
            }
            return false;
        }
    };

    if (isCurrentlyListening) {
        try {
            recognition.onend = () => {
                isCurrentlyListening = false;
                beginRecognition();
            };
            recognition.stop();
            return true;
        } catch (e) {
            return beginRecognition();
        }
    } else {
        return beginRecognition();
    }
}

/**
 * Stops Push-To-Talk recording.
 */
export function stopPushToTalk() {
    if (!recognition) return;
    shouldBeListening = false;
    try {
        recognition.stop();
    } catch (e) {}
    setStatus('idle');
}

/**
 * Uses text-to-speech to speak the provided text.
 * @param {string} text - The text to speak.
 * @param {Object} [options] - Options for speech (rate, pitch, volume, voice).
 * @returns {Promise<void>} Resolves when speaking is finished.
 */
export function speak(text, options = {}) {
    if (!synthesis || !ttsEnabled || !text) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        // Cancel any ongoing speech
        try {
            synthesis.cancel();
        } catch (e) {}
        
        const chunks = chunkText(text);
        let currentChunkIndex = 0;
        
        const speakNextChunk = () => {
            if (currentChunkIndex >= chunks.length) {
                if (shouldBeListening) setStatus('listening');
                else setStatus('idle');
                resolve();
                return;
            }
            
            const chunk = chunks[currentChunkIndex];
            const utterance = new SpeechSynthesisUtterance(chunk);
            
            // Set properties
            utterance.rate = options.rate || speechRate;
            utterance.pitch = options.pitch || 1.0;
            utterance.volume = options.volume !== undefined ? options.volume : 1.0;
            
            if (options.voice) {
                utterance.voice = options.voice;
            } else if (preferredVoice) {
                const voices = synthesis.getVoices();
                const matchedVoice = voices.find(v => v.name === preferredVoice);
                if (matchedVoice) {
                    utterance.voice = matchedVoice;
                }
            }
            
            utterance.onstart = () => {
                setStatus('speaking');
            };
            
            utterance.onend = () => {
                currentChunkIndex++;
                speakNextChunk();
            };
            
            utterance.onerror = (event) => {
                console.error('Speech synthesis error:', event);
                if (shouldBeListening) setStatus('listening');
                else setStatus('idle');
                resolve(); 
            };
            
            synthesis.speak(utterance);
        };
        
        // Brief 50ms buffer to allow browser speech queue to reset cleanly after cancel()
        setTimeout(speakNextChunk, 50);
    });
}

/**
 * Speaks a chess move.
 * @param {string} san - The Standard Algebraic Notation of the move.
 * @param {string} [piece] - The piece moved.
 * @param {string} [from] - The starting square.
 * @param {string} [to] - The destination square.
 * @param {string} [flags] - Move flags (e.g., 'c' for capture, 'p' for promotion).
 * @returns {Promise<void>}
 */
export function speakMove(san, piece, from, to, flags) {
    const spokenText = formatMoveForSpeech(san, piece, from, to, flags);
    return speak(spokenText);
}

/**
 * Speaks a chess evaluation.
 * @param {string} evalText - The evaluation text to speak.
 * @returns {Promise<void>}
 */
export function speakEval(evalText) {
    // E.g., replace +1.5 with "White is ahead by 1.5 pawns"
    let spokenEval = evalText;
    if (spokenEval.startsWith('+')) {
        spokenEval = `White is ahead by ${spokenEval.substring(1)}`;
    } else if (spokenEval.startsWith('-')) {
        spokenEval = `Black is ahead by ${spokenEval.substring(1)}`;
    } else if (spokenEval.startsWith('M')) {
        spokenEval = `Mate in ${Math.abs(parseInt(spokenEval.substring(1)))}`;
    }
    
    return speak(spokenEval);
}

/**
 * Toggles Text-to-Speech on or off.
 * @param {boolean} enabled 
 */
export function setTTSEnabled(enabled) {
    ttsEnabled = !!enabled;
    if (!ttsEnabled && synthesis) {
        synthesis.cancel();
    }
}

/**
 * Checks if Text-to-Speech is enabled.
 * @returns {boolean}
 */
export function isTTSEnabled() {
    return ttsEnabled;
}

/**
 * Gets a list of available Text-to-Speech voices.
 * @returns {SpeechSynthesisVoice[]}
 */
export function getAvailableVoices() {
    if (!synthesis) return [];
    return synthesis.getVoices();
}

/**
 * Sets the preferred Text-to-Speech voice by name.
 * @param {string} voiceName 
 */
export function setVoice(voiceName) {
    preferredVoice = voiceName;
}

/**
 * Sets the speech rate for Text-to-Speech.
 * @param {number} rate - Rate between 0.5 and 2.0.
 */
export function setRate(rate) {
    // Clamp between 0.5 and 2.0
    speechRate = Math.max(0.5, Math.min(2.0, rate));
}
