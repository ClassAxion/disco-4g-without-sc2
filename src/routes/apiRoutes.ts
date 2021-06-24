import { Router } from 'express';

export default (clients: any) => {
    const router = Router();

    router.post('/token/check', (req, res) => {
        const { token } = req.body;

        const isValid: boolean = token === 'test';

        if (isValid) {
            res.status(200).json({ status: true });
        } else {
            res.status(400).json({ status: false });
        }
    });

    router.get('/user/:id/permissions', (req, res) => {
        const socketId = req.params.id;

        const client = clients.find((client) => client.socket.id === socketId);

        if (!client) return res.sendStatus(404);

        res.json(client.socket.permissions);
    });

    router.get('/user/:id/permission/:key/set/:value', (req, res) => {
        const socketId = req.params.id;

        const client = clients.find((client) => client.socket.id === socketId);

        if (!client) return res.sendStatus(404);

        const { key, value } = req.params;

        client.socket.permissions[key] = Boolean(value);

        client.peer.send(
            JSON.stringify({
                action: 'permission',
                data: {
                    [key]: Boolean(value),
                },
            }),
        );

        res.json(client.socket.permissions);
    });

    return router;
};
