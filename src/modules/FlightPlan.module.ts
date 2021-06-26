import { FlightPlanWaypoint } from 'enums/FlightPlanWaypoint.enum';

export default class FlightPlan {
    constructor(private readonly name: string = 'plan') {}

    public getName(): string {
        return this.name;
    }

    public addWaypoint(
        type: FlightPlanWaypoint,
        location: { latitude: number; longitude: number },
        extras: any[],
    ): number {
        return 0;
    }

    public deleteWaypoint(id: number): boolean {
        return false;
    }

    public moveWaypoint(id: number, location: { latitude: number; longitude: number }): boolean {
        return false;
    }
}
