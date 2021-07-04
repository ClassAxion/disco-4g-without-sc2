import { Socket, io } from 'socket.io-client';
import { Logger } from 'winston';

export default class ParrotDiscoMap {
    private socket: Socket;

    private isConnected: boolean = false;

    constructor(path: string, private readonly logger: Logger, private readonly discoId: string) {
        this.socket = io({
            path,
        });

        this.socket.on('disconnect', this.onDisconnect);
        this.socket.on('connect', this.onConnect);
        this.socket.on('reconnect', this.onConnect);
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

    public sendAngle(angle: number): void {
        if (!this.isConnected) return;

        this.socket.emit('angle', { angle });
    }

    public sendSpeed(speed: number): void {
        if (!this.isConnected) return;

        this.socket.emit('speed', { speed });
    }
}
