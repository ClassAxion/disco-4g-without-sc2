import { Socket, io } from 'socket.io-client';
import { Logger } from 'winston';

export default class ParrotDiscoMap {
    private socket: Socket;

    private isConnected: boolean = false;

    constructor(
        private readonly url: string,
        private readonly logger: Logger,
        private readonly discoId: string,
        private readonly enabled: boolean = true,
    ) {
        if (this.enabled) {
            this.socket = io(this.url);

            this.socket.on('disconnect', this.onDisconnect.bind(this));
            this.socket.on('connect', this.onConnect.bind(this));
            this.socket.on('reconnect', this.onConnect.bind(this));
        }
    }

    private onConnect(): void {
        this.logger.info(`Parrot Disco global map connected`);

        this.isConnected = true;

        this.socket.emit('disco', { id: this.discoId });
    }

    private onDisconnect(): void {
        this.logger.info(`Parrot Disco global map disconnected`);

        this.isConnected = false;
    }

    public sendLocation(latitude: number, longitude: number): void {
        if (!this.isConnected) return;

        this.socket.emit('location', { latitude, longitude });
    }

    public sendAltitude(altitude: number): void {
        if (!this.isConnected) return;

        this.socket.emit('altitude', { altitude });
    }

    public sendYaw(yaw: number): void {
        if (!this.isConnected) return;

        this.socket.emit('yaw', { yaw });
    }

    public sendSpeed(speed: number): void {
        if (!this.isConnected) return;

        this.socket.emit('speed', { speed });
    }
}
