import { Component, OnInit, NgZone, signal } from '@angular/core';
import { AgentService } from './services/agent';

// Tell TypeScript about the native browser API
declare var webkitSpeechRecognition: any;

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  standalone: false,
  styleUrl: './app.css',
})
export class App implements OnInit {

  protected readonly title = signal('agent-frontend');

  messages: { role: string, text: string }[] = [];

  // Speech Recognition State
  isListening = false;
  interimText = '';
  recognition: any;

  constructor(
    public agentService: AgentService,
    private ngZone: NgZone
  ) { }

  ngOnInit() {
    // Connect to your deployed Cloud Run FastAPI server
    const websocketUrl = window.location.hostname === 'localhost'
      ? 'wss://veritylens-backend-563576709291.us-central1.run.app/chat'
      : 'wss://veritylens-backend-563576709291.us-central1.run.app/chat';
    this.agentService.connect(websocketUrl);

    // Listen for agent replies and add them to the chat
    this.agentService.transcript$.subscribe((text) => {
      this.ngZone.run(() => {
        this.messages.push({ role: 'agent', text });
      });
    });

    this.initSpeechRecognition();
  }

  initSpeechRecognition() {
    if ('webkitSpeechRecognition' in window) {
      this.recognition = new webkitSpeechRecognition();
      this.recognition.continuous = false;
      this.recognition.interimResults = true;

      this.recognition.onstart = () => {
        this.ngZone.run(() => this.isListening = true);
      };

      this.recognition.onresult = (event: any) => {
        this.ngZone.run(() => {
          let finalTranscript = '';
          let interimTranscript = '';

          // Loop through the results and cleanly separate final vs interim text
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript;
            } else {
              interimTranscript += event.results[i][0].transcript;
            }
          }

          // Update the UI with the guessing text
          this.interimText = interimTranscript;

          // If the sentence is finished, send it and clear the box!
          if (finalTranscript.trim() !== '') {
            this.sendMessage(finalTranscript);
            this.interimText = '';
          }
        });
      };

      this.recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        this.ngZone.run(() => this.isListening = false);
      };

      this.recognition.onend = () => {
        this.ngZone.run(() => this.isListening = false);
      };
    } else {
      console.warn('Speech recognition is not supported in this browser.');
    }
  }

  toggleListening() {
    if (!this.recognition) return;

    this.agentService.ensureAudioResumed();

    if (this.isListening) {
      this.recognition.stop();
    } else {
      this.interimText = '';
      this.recognition.start();
    }
  }

  startListening() {
    this.toggleListening();
  }

  sendMessage(text: string) {
    if (!text || text.trim() === '') return;
    this.agentService.ensureAudioResumed();
    this.messages.push({ role: 'user', text: text });
    this.agentService.sendMessage(text);
    this.interimText = '';
  }
}
