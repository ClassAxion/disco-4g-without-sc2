import { Instance as Peer } from 'simple-peer';

import { User } from '../interfaces/User.interface';

export default class Users {
    private users: { [key: string]: User } = {};

    public create(
        id: string,
        ip: string,
        permissions: { [key: string]: boolean } = {},
        peer?: Peer,
        socket?: any,
        stream?: any,
        isAuthorized = false,
    ): void {
        this.users[id] = {
            id,
            ip,
            permissions,
            peer,
            socket,
            stream,
            isAuthorized,
        };
    }

    public delete(id: string): void {
        delete this.users[id];
    }

    public setIp(id: string, ip: string): void {
        this.users[id].ip = ip;
    }

    public getIp(id: string): string | undefined {
        return this.users[id]?.ip;
    }

    public setPeer(id: string, peer: Peer): void {
        this.users[id].peer = peer;
    }

    public getPeer(id: string): Peer {
        return this.users[id].peer;
    }

    public setSocket(id: string, socket: any): void {
        this.users[id].socket = socket;
    }

    public getSocket(id: string): any {
        return this.users[id].socket;
    }

    public setStream(id: string, stream: any): void {
        this.users[id].stream = stream;
    }

    public getStream(id: string): any {
        return this.users[id].stream;
    }

    public getPermissions(id: string): { [key: string]: boolean } | null {
        return !this.users[id] ? null : this.users[id].permissions;
    }

    public getPermission(id: string, key: string): boolean {
        return this.users[id].permissions[key];
    }

    public setPermission(id: string, key: string, value: boolean): void {
        this.users[id].permissions[key] = value;
    }

    public setAuthorized(id: string, value: boolean): void {
        this.users[id].isAuthorized = value;
    }

    public setPermissions(id: string, permissions: { [key: string]: boolean }): void {
        this.users[id].permissions = permissions;
    }

    public getUsers() {
        return this.users;
    }

    public getAuthorizedUsers() {
        const users: { [key: string]: User } = {};

        for (const id in this.users) {
            if (this.users[id].isAuthorized) {
                users[id] = this.users[id];
            }
        }

        return users;
    }

    public getUser(id: string): User {
        return this.users[id];
    }

    public exists(id: string): boolean {
        return !!this.users[id];
    }
}
