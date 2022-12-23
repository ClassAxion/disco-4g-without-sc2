export default class Validation {
    public static axis(value: number): number {
        if (value > 75) return 75;
        if (value < -75) return -75;

        return value;
    }

    public static throttle(value: number): number {
        if (value > 100) return 100;
        if (value < -100) return -100;

        return value;
    }

    public static isValidCircleDirection(value: string): boolean {
        return ['cw', 'ccw'].includes(value.toLocaleLowerCase());
    }

    public static circleDirection(value: string): string {
        if (['cw', 'ccw'].includes(value.toLocaleLowerCase())) {
            return value.toUpperCase();
        }

        return 'CW';
    }
}
