import { EnclosureInfo, MachineInfo, NetworkConfiguration, NetworkOptions, NetworkStationState } from '@snapmaker/snapmaker-sacp-sdk/dist/models';
import { EventEmitter } from 'events';

import SocketServer from '../../../lib/SocketManager';

interface ConnectionOpenOptions {
    address?: string;
    host?: string;
    port?: string;
    token?: string;
}
interface ConnectionCloseOptions {
    force?: boolean;
}

/**
 * Defines basic Channel functions.
 */
export default class Channel extends EventEmitter {
    protected socket: SocketServer;

    public setSocket(socket: SocketServer): void {
        this.socket = socket;
    }

    /**
     * Connection open.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public async connectionOpen(options?: ConnectionOpenOptions): Promise<boolean> {
        return false;
    }

    /**
     * Connection close.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    public async connectionClose(options?: ConnectionCloseOptions): Promise<boolean> {
        return false;
    }

    /**
     * Start heartbeat.
     */
    public async startHeartbeat(): Promise<void> {
        return Promise.resolve();
    }

    public async stopHeartbeat(): Promise<void> {
        return Promise.resolve();
    }
}

// G-code

export interface GcodeChannelInterface extends Channel {
    executeGcode(gcode: string): Promise<boolean>;
}

// File

export interface UploadFileOptions {
    filePath: string;
    targetFilename?: string;
}
export interface FileChannelInterface extends Channel {
    uploadFile(options: UploadFileOptions): Promise<boolean>;

    compressUploadFile(options: UploadFileOptions): Promise<boolean>;
}

// System

export interface UpgradeFirmwareOptions {
    filename: string;
}

export interface SystemChannelInterface extends Channel {
    getMachineInfo(): Promise<MachineInfo>;

    // log
    exportLogToExternalStorage(): Promise<boolean>;

    // firmware
    getFirmwareVersion(): Promise<string>;

    upgradeFirmwareFromFile(options: UpgradeFirmwareOptions): Promise<boolean>;
}

// Network

export interface NetworkServiceChannelInterface extends Channel {
    configureNetwork(networkOptions: NetworkOptions): Promise<boolean>;
    getNetworkConfiguration(): Promise<NetworkConfiguration>;
    getNetworkStationState(): Promise<NetworkStationState>;
}

// Print Job

export interface PrintJobChannelInterface extends Channel {
    // TODO: add callback
    subscribeGetPrintCurrentLineNumber(): Promise<boolean>;
    unsubscribeGetPrintCurrentLineNumber(): Promise<boolean>;
}

// Laser

export interface LaserChannelInterface extends Channel {
    getCrosshairOffset(): Promise<{x: number; y: number}>;
    setCrosshairOffset(x: number, y: number): Promise<boolean>;
    getFireSensorSensitivity(): Promise<number>;
    setFireSensorSensitivity(sensitivity: number): Promise<boolean>;
}

// CNC

export interface CncChannelInterface extends Channel {
    setSpindleSpeed(speed: number): Promise<boolean>;
    setSpindleSpeedPercentage(percent: number): Promise<boolean>;
    spindleOn(): Promise<boolean>;
    spindleOff(): Promise<boolean>;
}


export interface EnclosureChannelInterface extends Channel {
    getEnclosreInfo(): Promise<EnclosureInfo>;

    /**
     * Set enclosure light intensity.
     *
     * @param intensity 0-100
     */
    setEnclosureLight(intensity: number): Promise<boolean>;

    /**
     * Set enclosure fan strength.
     * @param strength 0-100
     */
    setEnclosureFan(strength: number): Promise<boolean>;
}

export interface AirPurifierChannelInterface extends Channel {
    /**
     * Turn on
     */
    turnOnAirPurifier(): Promise<boolean>;

    /**
     * Turn off
     */
    turnOffAirPurifier(): Promise<boolean>;

    /**
     * Set Air purifier strength.
     *
     * @param strength 1-3 (low / medium / high)
     */
    setAirPurifierStrength(strength: 1 | 2 | 3): Promise<boolean>;
}
