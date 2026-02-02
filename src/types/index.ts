export interface Track {
  id: string;
  title: string;
  artist: string;
  duration: number;
  fileSize: number;
  messageId: number;
  mimeType: string;
  chatId?: string;
}

export interface AudioSource {
  id: string;
  title: string;
  type: 'user' | 'chat' | 'channel';
}

export interface PlayerState {
  currentTrack: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  tracks: Track[];
  isLoading: boolean;
}

export interface AuthState {
  isAuthenticated: boolean;
  phoneNumber: string;
  session: string | null;
}
