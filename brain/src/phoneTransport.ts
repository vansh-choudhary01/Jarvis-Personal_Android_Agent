import type {BrainMessage} from './protocol.js';

export interface PhoneTransport {
  isConnected(): boolean;
  send(message: BrainMessage): void;
  onClose(listener: () => void): void;
  close?(code?: number, reason?: string): void;
}
