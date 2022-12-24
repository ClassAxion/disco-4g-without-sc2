import { Instance as Peer } from 'simple-peer';
import { Socket } from 'socket.io';

export interface User {
    id: string;
    ip: string;
    peer?: Peer;
    socket?: Socket;
    stream?: any;
    permissions: { [key: string]: boolean };
    isAuthorized: boolean;
}
