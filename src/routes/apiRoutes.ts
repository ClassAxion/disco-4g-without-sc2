import { Router } from 'express';

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

export default router;
