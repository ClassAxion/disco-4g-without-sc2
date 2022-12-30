export {};

declare global {
    namespace NodeJS {
        interface ProcessEnv {
            STREAM_VIDEO_PORT?: string;
            STREAM_CONTROL_PORT?: string;
            D2C_PORT?: string;
            STREAM_QUALITY?: string;
            NO_DISCO?: string;
            DISCO_ID?: string;
            MAP?: string;
            HOME_LOCATION?: string;
        }
    }
}
