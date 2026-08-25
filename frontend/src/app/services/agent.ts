import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

@Injectable({
  providedIn: 'root'
})
export class AgentService {
  // Observables that your components will subscribe to
  public currentVolume$ = new BehaviorSubject<number>(0);
  public transcript$ = new Subject<string>();
  public connectionStatus$ = new BehaviorSubject<ConnectionStatus>('disconnected');

  private ws?: WebSocket;
  private websocketUrl?: string;
  private messageQueue: string[] = [];
  private reconnectTimer?: any;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 16000;
  private isExplicitlyClosed = false;

  private audioCtx!: AudioContext;
  private analyser!: AnalyserNode;
  private isAnalyzing = false;

  // Property to hold the user's anonymous session ID
  private guestId!: string;

  constructor(private ngZone: NgZone) {
    this.initAudio();
    this.initGuestId();
  }

  private initGuestId() {
    // Retrieve the existing ID, or generate and store a new one if it doesn't exist
    let storedId = localStorage.getItem('guest_id');
    if (!storedId) {
      storedId = 'guest_' + Math.random().toString(36).substring(2, 10);
      localStorage.setItem('guest_id', storedId);
    }
    this.guestId = storedId;
  }

  private initAudio() {
    // Initialize Web Audio API (handles cross-browser compatibility)
    this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.analyser = this.audioCtx.createAnalyser();

    // fftSize determines how detailed the frequency data is. 
    // 256 is the perfect balance for performant lip-syncing.
    this.analyser.fftSize = 256;

    // Connect the analyser to the speakers
    this.analyser.connect(this.audioCtx.destination);
  }

  public async ensureAudioResumed() {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }
  }

  public connect(websocketUrl: string) {
    this.websocketUrl = websocketUrl;
    this.isExplicitlyClosed = false;

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    this.connectionStatus$.next('connecting');

    try {
      this.ws = new WebSocket(websocketUrl);
    } catch (err) {
      console.error('Failed to create WebSocket:', err);
      this.connectionStatus$.next('disconnected');
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log('WebSocket Connection Established');
      this.connectionStatus$.next('connected');
      this.reconnectDelay = 1000;
      this.flushQueue();
    };

    this.ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.text) {
          // Push the text to the UI transcript panel immediately
          this.transcript$.next(data.text);
        }

        if (data.audio) {
          // Decode and play the audio, then start the lip-sync analysis loop
          await this.playBase64Audio(data.audio);
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    };

    this.ws.onerror = (error) => console.error('WebSocket Error:', error);

    this.ws.onclose = (event) => {
      console.log('WebSocket Connection Closed:', event.code, event.reason);
      this.connectionStatus$.next('disconnected');
      if (!this.isExplicitlyClosed) {
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.isExplicitlyClosed || !this.websocketUrl) return;

    console.log(`Reconnecting WebSocket in ${this.reconnectDelay}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      if (this.websocketUrl) {
        this.connect(this.websocketUrl);
      }
    }, this.reconnectDelay);
  }

  private flushQueue() {
    while (this.messageQueue.length > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
      const text = this.messageQueue.shift();
      if (text) {
        this.sendPayload(text);
      }
    }
  }

  public sendMessage(text: string) {
    if (!text || text.trim() === '') return;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendPayload(text);
    } else {
      console.warn("WebSocket is not open. Queuing message for when connection is ready:", text);
      this.messageQueue.push(text);
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        if (this.websocketUrl) {
          this.connect(this.websocketUrl);
        }
      }
    }
  }

  private sendPayload(text: string) {
    const payload = {
      guest_id: this.guestId,
      message: text
    };
    this.ws?.send(JSON.stringify(payload));
  }

  public disconnect() {
    this.isExplicitlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.ws) {
      this.ws.close();
    }
    this.connectionStatus$.next('disconnected');
  }

  private async playBase64Audio(base64String: string) {
    // Browser requirement: Resume audio context after user's first interaction
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume();
    }

    // 1. Decode Base64 to a raw binary string
    const binaryString = window.atob(base64String);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);

    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // 2. Decode the raw audio data using the AudioContext
    const audioBuffer = await this.audioCtx.decodeAudioData(bytes.buffer);

    // 3. Set up the audio source and connect it to the analyser
    const source = this.audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.analyser);

    // 4. Play the audio and start analyzing the volume
    source.start(0);
    this.isAnalyzing = true;
    this.analyzeVolume();

    // 5. Stop analyzing when the audio finishes speaking
    source.onended = () => {
      this.isAnalyzing = false;
      this.currentVolume$.next(0); // Force mouth closed
    };
  }

  private analyzeVolume() {
    if (!this.isAnalyzing) return;

    // Run this heavy loop outside Angular's change detection
    this.ngZone.runOutsideAngular(() => {
      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      const loop = () => {
        if (!this.isAnalyzing) return;

        this.analyser.getByteFrequencyData(dataArray);

        // Calculate the average volume (amplitude) of the current frame
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;

        // Normalize the volume to a number between 0.0 and 1.0 for the 3D blendshape
        // Dividing by 100 makes the mouth more responsive than dividing by 255
        let volume = average / 100;
        if (volume > 1) volume = 1;

        // Push the new volume to the BehaviorSubject
        this.currentVolume$.next(volume);

        // Request the next animation frame
        requestAnimationFrame(loop);
      };

      loop();
    });
  }
}