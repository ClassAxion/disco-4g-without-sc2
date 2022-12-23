export {};

declare global {
    namespace NodeJS {
        interface ProcessEnv {
            STREAM_QUALITY: string;
        }
    }
}
