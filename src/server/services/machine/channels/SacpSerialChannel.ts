import crypto from 'crypto';
import fs from 'fs';
import { SerialPort } from 'serialport';

import { SACP_TYPE_SERIES_MAP } from '../../../../app/constants/machines';
import DataStorage from '../../../DataStorage';
import { HEAD_CNC, HEAD_LASER, HEAD_PRINTING } from '../../../constants';
import logger from '../../../lib/logger';
import Business from '../sacp/Business';
import { EventOptions } from '../types';
import { FileChannelInterface, UploadFileOptions } from './Channel';
import { ChannelEvent } from './ChannelEvent';
import SacpChannelBase from './SacpChannel';

const log = logger('machine:channel:SacpSerialChannel');

class SacpSerialChannel extends SacpChannelBase implements FileChannelInterface {
    private serialport: SerialPort;

    // public startTime: number;

    // public sent: number;

    // public total: number;

    public async connectionOpen(options: { port: string }): Promise<boolean> {
        const port = options.port;

        if (!port) {
            return false;
        }

        // connecting
        this.emit(ChannelEvent.Connecting);

        return new Promise((resolve) => {
            this.serialport = new SerialPort({
                path: port,
                baudRate: 115200,
                autoOpen: false,
            });
            this.sacpClient = new Business('serialport', this.serialport);

            this.serialport.on('data', (data) => {
                // console.log(data.toString());
                this.sacpClient.read(data);
            });

            this.serialport.on('error', (err) => {
                log.error(`Serial connection error: ${err}`);
                this.socket.emit('connection:connected', { err: 'this machine is not ready' });
            });

            this.serialport.on('close', () => {
                log.info('serial close');
                this.socket.emit('connection:close');
            });

            // When serialport connected, we detect the machine identifier
            this.serialport.once('open', () => {
                this.emit(ChannelEvent.Connected);

                log.debug(`Serial port ${port} opened`);

                // Force switch to SACP
                this.serialport.write('\r\n');
                this.serialport.write('M2000 S5 P1\r\n');
                // this.serialport.write('M2000 U5\r\n');
                this.serialport.write('$PS\r\n');

                log.error('M2000 sent');

                // Wait (at least 100ms) to let controller switch to SACP
                // Then we get machine info, this is required to detect the machine
                setTimeout(async () => {
                    // Get Machine Info
                    const { data: machineInfos } = await this.getMachineInfo();
                    const machineIdentifier = SACP_TYPE_SERIES_MAP[machineInfos.type];
                    log.debug(`Get machine info, type = ${machineInfos.type}`);
                    log.debug(`Get machine info, machine identifier = ${machineIdentifier}`);

                    // Machine detected
                    this.emit(ChannelEvent.Ready, {
                        machineIdentifier,
                    });

                    resolve(true);
                }, 1000);
            });

            // Open serial port
            this.emit(ChannelEvent.Connecting);

            this.serialport.open();
        });
    }

    public async connectionClose(): Promise<boolean> {
        this.serialport?.close();
        this.serialport?.destroy();
        this.sacpClient?.dispose();

        return true;
    }

    public async startHeartbeat(): Promise<void> {
        // TODO:
        // - only start heartbeat
        // - and start subscriptions on instance

        // await this.startHeartbeatBase(this.sacpClient);
        // this.setROTSubscribeApi();
    }

    public startGcode = async (options: EventOptions) => {
        const { headType } = options;
        log.info(`serial start gcode, ${headType}`);
        let type = 0;
        if (headType === HEAD_PRINTING) {
            type = 0;
        } else if (headType === HEAD_LASER) {
            type = 2;
        } else if (headType === HEAD_CNC) {
            type = 1;
        }
        const gcodeFilePath = `${DataStorage.tmpDir}/${options.uploadName}`;
        await this.sacpClient.startPrintSerial(gcodeFilePath, ({ length }) => {
            this.totalLine !== length && (this.totalLine = length);
        });
        const md5 = crypto.createHash('md5');
        const readStream = fs.createReadStream(gcodeFilePath);
        readStream.on('data', buf => {
            md5.update(buf);
        });
        readStream.once('end', async () => {
            this.sacpClient.startPrint(md5.digest().toString('hex'), options.uploadName, type).then(({ response }) => {
                log.info(`startPrinting: ${response.result}`);
                response.result === 0 && (this.startTime = new Date().getTime());
            });
        });
    };

    public async uploadFile(options: UploadFileOptions): Promise<boolean> {
        const { filePath, targetFilename } = options;
        log.info(`Upload file to controller... ${filePath}`);

        // Note: Use upload large file API instead of upload file API, newer firmware will implement this API
        // rather than the old ones.
        const res = await this.sacpClient.uploadLargeFile(filePath, targetFilename);

        return (res.response.result === 0);
    }
}

const sacpSerialChannel = new SacpSerialChannel();

export {
    sacpSerialChannel
};

export default SacpSerialChannel;