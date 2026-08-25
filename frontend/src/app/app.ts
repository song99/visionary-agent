import { Component, OnInit, NgZone, signal, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { AgentService, ConnectionStatus } from './services/agent';

// Tell TypeScript about the native browser API
declare var webkitSpeechRecognition: any;

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  standalone: false,
  styleUrl: './app.css',
})
export class App implements OnInit, AfterViewChecked {

  @ViewChild('scrollContainer') private scrollContainer!: ElementRef;

  protected readonly title = signal('agent-frontend');

  messages: { role: string, text: string }[] = [];
  connectionStatus: ConnectionStatus = 'disconnected';
  private shouldScrollToBottom = false;

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
    const websocketUrl = 'wss://agent-backend-563576709291.us-central1.run.app/chat';
    this.agentService.connect(websocketUrl);

    this.agentService.connectionStatus$.subscribe((status) => {
      this.ngZone.run(() => {
        this.connectionStatus = status;
      });
    });

    // Listen for agent replies and add them to the chat
    this.agentService.transcript$.subscribe((text) => {
      this.ngZone.run(() => {
        this.messages.push({ role: 'agent', text });
        this.shouldScrollToBottom = true;
      });
    });

    this.initSpeechRecognition();
  }

  ngAfterViewChecked() {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }
  }

  private scrollToBottom(): void {
    try {
      if (this.scrollContainer && this.scrollContainer.nativeElement) {
        this.scrollContainer.nativeElement.scrollTop = this.scrollContainer.nativeElement.scrollHeight;
      }
    } catch (err) { }
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
    this.shouldScrollToBottom = true;
  }
}
