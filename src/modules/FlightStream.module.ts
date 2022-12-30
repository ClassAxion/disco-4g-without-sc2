import wrtc from 'wrtc';
import ffmpeg from 'fluent-ffmpeg';
import { Logger } from 'winston';
import { writeFile } from 'fs/promises';

import paths, { Paths } from '../utils/paths';

export type Resolution = {
    width: number;
    height: number;
};

export const Resolutions: { [key: string]: Resolution } = {
    '480p': { width: 856, height: 480 },
    '720p': { width: 1280, height: 720 },
};

export default class FlightStream {
    private process: any;
    private output: any;
    private running: boolean;

    constructor(
        private readonly logger: Logger,
        private readonly resolution: Resolution = { width: 856, height: 480 },
        private readonly port: number = 55004,
    ) {}

    private async createSDP() {
        await writeFile(
            paths[Paths.SDP],
            `c=IN IP4 192.168.42.1\nm=video ${this.port} RTP/AVP 96\na=rtpmap:96 H264/90000\n`,
            'utf-8',
        );
    }

    public async start(): Promise<void> {
        await this.createSDP();

        this.output = await require('wrtc-to-ffmpeg')(wrtc).output({
            kind: 'video',
            width: this.resolution.width,
            height: this.resolution.height,
        });

        this.process = ffmpeg()
            .input(paths[Paths.SDP])
            .inputOption('-protocol_whitelist file,udp,rtp')
            .output(this.output.url)
            .outputOptions(this.output.options)
            .on('start', (command) => {
                this.logger.debug(`Flight stream started:`, command);

                this.running = true;
            })
            .on('error', (error) => {
                this.logger.error(`Flight stream exited:`, error);

                this.running = false;
            });

        this.process.run();
    }

    public async stop(): Promise<void> {
        this.process.kill();

        this.running = false;
    }

    public isRunning(): boolean {
        return this.running;
    }

    public getOutput(): any {
        return this.output;
    }
}
