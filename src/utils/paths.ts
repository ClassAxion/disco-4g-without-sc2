import { join } from 'path';

import isDev from './isDev';

export enum Paths {
    FLIGHT_PLANS,
    SDP,
}

const development: { [key: number]: string } = {
    [Paths.FLIGHT_PLANS]: join(__dirname, '..', '..', 'flightplans'),
    [Paths.SDP]: join(__dirname, '..', '..', 'stream.sdp'),
};

const production: { [key: number]: string } = {
    [Paths.FLIGHT_PLANS]: join(__dirname, '..', 'flightplans'),
    [Paths.SDP]: join(__dirname, '..', 'stream.sdp'),
};

export default isDev ? development : production;
