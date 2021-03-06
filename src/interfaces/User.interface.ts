import { Instance as Peer } from 'simple-peer';

export interface User {
    id: string;
    ip?: string;
    peer?: Peer;
    socket?: any;
    permissions: { [key: string]: boolean };
}
