import EventEmitter from 'events';
import { Server, Socket } from 'socket.io';
import { Logger } from 'winston';

export default class RemoteControl extends EventEmitter {
    private sockets: { [key: string]: Socket } = {};

    constructor(port: number = 9999, private readonly logger: Logger) {
        super();

        const io = new Server(port, {
            allowEIO3: true,
        });

        io.on('connection', this.onConnection.bind(this));
    }

    private onConnection(socket: Socket) {
        this.sockets[socket.id] = socket;

        socket.on('disconnect', () => {
            delete this.sockets[socket.id];

            this.emit('move', {
                pitch: 0,
                roll: 0,
                throttle: 0,
            });

            this.logger.info(`Remote controller disconnected`);
        });

        socket.on('move', ({ pitch, roll, throttle }) => this.emit('move', { pitch, roll, throttle }));

        this.logger.info(`Remote controller connected`);
    }

    public sendLocation(latitude: number, longitude: number) {
        for (const socket of Object.values(this.sockets)) {
            socket.emit('location', { latitude, longitude });
        }
    }

    public sendAltitude(altitude: number) {
        for (const socket of Object.values(this.sockets)) {
            socket.emit('altitude', { altitude });
        }
    }

    public sendHeading(heading: number) {
        for (const socket of Object.values(this.sockets)) {
            socket.emit('heading', { heading });
        }
    }

    public sendSpeed(speed: number) {
        for (const socket of Object.values(this.sockets)) {
            socket.emit('speed', { speed });
        }
    }
}
