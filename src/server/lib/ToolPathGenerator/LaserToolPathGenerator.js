import Jimp from 'jimp';
import EventEmitter from 'events';
import SVGParser, { flip, rotate, scale, sortShapes, translate } from '../SVGParser';
import GcodeParser from './GcodeParser';
import Normalizer from './Normalizer';
import { svgToSegments } from './SVGFill';
import { parseDxf, dxfToSvg, updateDxfBoundingBox } from '../../../shared/lib/DXFParser/Parser';
// function cross(p0, p1, p2) {
//     return (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
// }

function pointEqual(p1, p2) {
    return p1[0] === p2[0] && p1[1] === p2[1];
}

class LaserToolPathGenerator extends EventEmitter {
    getGcodeHeader() {
        const date = new Date();
        return [
            '; G-code for laser engraving',
            '; Generated by Snapmaker Luban',
            `; ${date.toDateString()} ${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`,
            '\n'
        ];
    }

    async generateToolPathObj(modelInfo, modelPath) {
        const { mode, config, sourceType } = modelInfo;
        const { movementMode } = config;

        let fakeGcodes = this.getGcodeHeader();

        fakeGcodes.push('G90');
        fakeGcodes.push('G21');
        let workingGcode = '';
        if (mode === 'bw' || (mode === 'greyscale' && movementMode === 'greyscale-line')) {
            workingGcode = await this.generateGcodeBW(modelInfo, modelPath);
        } else if (mode === 'greyscale') {
            workingGcode = await this.generateGcodeGreyscale(modelInfo, modelPath);
        } else if (mode === 'vector' && sourceType === 'dxf') {
            workingGcode = await this.generateGcodeDxf(modelInfo, modelPath);
        } else if (mode === 'vector' || mode === 'trace') {
            workingGcode = await this.generateGcodeVector(modelInfo, modelPath);
        } else {
            return Promise.reject(new Error(`Unsupported process mode: ${mode}`));
        }

        fakeGcodes.push('; G-code START <<<');
        fakeGcodes.push('M106 P0 S255');

        fakeGcodes = fakeGcodes.concat(workingGcode);

        fakeGcodes.push('M107 P0');
        fakeGcodes.push('; G-code END <<<');

        const toolPathObject = new GcodeParser().parseGcodeToToolPathObj(fakeGcodes, modelInfo);
        return toolPathObject;
    }

    async generateGcodeGreyscale(modelInfo, modelPath) {
        const { gcodeConfigPlaceholder, config, gcodeConfig } = modelInfo;
        const { fixedPowerEnabled, fixedPower } = gcodeConfig;
        const { workSpeed, dwellTime } = gcodeConfigPlaceholder;
        const { bwThreshold } = config;

        const img = await Jimp.read(modelPath);
        img.mirror(false, true);

        const width = img.bitmap.width;
        const height = img.bitmap.height;

        const normalizer = new Normalizer('Center', 0, width, 0, height, {
            x: 1 / config.density,
            y: 1 / config.density
        });

        let progress = 0;

        let firstTurnOn = true;
        function turnOnLaser() {
            if (firstTurnOn && fixedPowerEnabled) {
                firstTurnOn = false;
                const powerStrength = Math.floor(fixedPower * 255 / 100);
                return `M3 P${fixedPower} S${powerStrength}`;
            }
            return 'M3';
        }

        const content = [];
        content.push(`G1 F${workSpeed}`);

        for (let i = 0; i < width; ++i) {
            const isReverse = (i % 2 === 0);
            for (let j = (isReverse ? height : 0); isReverse ? j >= 0 : j < height; isReverse ? j-- : j++) {
                const idx = j * width * 4 + i * 4;
                if (img.bitmap.data[idx] < bwThreshold) {
                    content.push(`G1 X${normalizer.x(i)} Y${normalizer.y(j)}`);
                    content.push(turnOnLaser());
                    content.push(`G4 P${dwellTime}`);
                    content.push('M05');
                }
            }
            const p = i / width;
            if (p - progress > 0.05) {
                progress = p;
                this.emit('progress', progress);
            }
        }
        content.push('G0 X0 Y0');

        return content;
    }

    async generateGcodeBW(modelInfo, modelPath) {
        const { gcodeConfigPlaceholder, config, gcodeConfig } = modelInfo;
        const { fixedPowerEnabled, fixedPower } = gcodeConfig;
        const { workSpeed, jogSpeed } = gcodeConfigPlaceholder;
        const { bwThreshold } = config;

        function bitEqual(a, b) {
            return (a <= bwThreshold && b <= bwThreshold) || (a > bwThreshold && b > bwThreshold);
        }

        function extractSegment(data, start, box, direction, sign) {
            let len = 1;

            function idx(pos) {
                return pos.x * 4 + pos.y * box.width * 4;
            }

            for (; ;) {
                const cur = {
                    x: start.x + direction.x * len * sign,
                    y: start.y + direction.y * len * sign
                };
                if (!bitEqual(data[idx(cur)], data[idx(start)])
                    || cur.x < 0 || cur.x >= box.width
                    || cur.y < 0 || cur.y >= box.height) {
                    break;
                }
                len += 1;
            }
            return len;
        }

        let firstTurnOn = true;
        function turnOnLaser() {
            if (firstTurnOn && fixedPowerEnabled) {
                firstTurnOn = false;
                const powerStrength = Math.floor(fixedPower * 255 / 100);
                return `M3 P${fixedPower} S${powerStrength}`;
            }
            return 'M3';
        }

        function genMovement(normalizer, start, end) {
            return [
                `G0 X${normalizer.x(start.x)} Y${normalizer.y(start.y)}`,
                turnOnLaser(),
                `G1 X${normalizer.x(end.x)} Y${normalizer.y(end.y)}`,
                'M5'
            ];
        }

        const img = await Jimp.read(modelPath);
        img.mirror(false, true);

        const width = img.bitmap.width;
        const height = img.bitmap.height;

        const normalizer = new Normalizer('Center', 0, width, 0, height, {
            x: 1 / config.density,
            y: 1 / config.density
        });

        let progress = 0;
        const content = [];
        content.push(`G0 F${jogSpeed}`);
        content.push(`G1 F${workSpeed}`);

        if (!config.direction || config.direction === 'Horizontal') {
            const direction = {
                x: 1,
                y: 0
            };
            for (let j = 0; j < height; j++) {
                let len = 0;
                const isReverse = (j % 2 !== 0);
                const sign = isReverse ? -1 : 1;
                for (let i = (isReverse ? width - 1 : 0); isReverse ? i >= 0 : i < width; i += len * sign) {
                    const idx = i * 4 + j * width * 4;
                    if (img.bitmap.data[idx] <= bwThreshold) {
                        const start = {
                            x: i,
                            y: j
                        };
                        len = extractSegment(img.bitmap.data, start, img.bitmap, direction, sign);
                        const end = {
                            x: start.x + direction.x * len * sign,
                            y: start.y + direction.y * len * sign
                        };
                        content.push(...genMovement(normalizer, start, end));
                    } else {
                        len = 1;
                    }
                }
                const p = j / height;
                if (p - progress > 0.05) {
                    progress = p;
                    this.emit('progress', progress);
                }
            }
        } else if (config.direction === 'Vertical') {
            const direction = {
                x: 0,
                y: 1
            };
            for (let i = 0; i < width; ++i) {
                let len = 0;
                const isReverse = (i % 2 !== 0);
                const sign = isReverse ? -1 : 1;
                for (let j = (isReverse ? height - 1 : 0); isReverse ? j >= 0 : j < height; j += len * sign) {
                    const idx = i * 4 + j * width * 4;
                    if (img.bitmap.data[idx] <= bwThreshold) {
                        const start = {
                            x: i,
                            y: j
                        };
                        len = extractSegment(img.bitmap.data, start, img.bitmap, direction, sign);
                        const end = {
                            x: start.x + direction.x * len * sign,
                            y: start.y + direction.y * len * sign
                        };
                        content.push(...genMovement(normalizer, start, end));
                    } else {
                        len = 1;
                    }
                }
                const p = i / width;
                if (p - progress > 0.05) {
                    progress = p;
                    this.emit('progress', progress);
                }
            }
        } else if (config.direction === 'Diagonal') {
            const direction = {
                x: 1,
                y: -1
            };
            for (let k = 0; k < width + height - 1; k++) {
                let len = 0;
                const isReverse = (k % 2 !== 0);
                const sign = isReverse ? -1 : 1;
                for (let i = (isReverse ? width - 1 : 0); isReverse ? i >= 0 : i < width; i += len * sign) {
                    const j = k - i;
                    if (j < 0 || j > height) {
                        len = 1; // FIXME: optimize
                    } else {
                        const idx = i * 4 + j * width * 4;
                        if (img.bitmap.data[idx] <= bwThreshold) {
                            const start = {
                                x: i,
                                y: j
                            };
                            len = extractSegment(img.bitmap.data, start, img.bitmap, direction, sign);
                            const end = {
                                x: start.x + direction.x * len * sign,
                                y: start.y + direction.y * len * sign
                            };
                            content.push(...genMovement(normalizer, start, end));
                        } else {
                            len = 1;
                        }
                    }
                }
                const p = k / (width + height);
                if (p - progress > 0.05) {
                    progress = p;
                    this.emit('progress', progress);
                }
            }
        } else if (config.direction === 'Diagonal2') {
            const direction = {
                x: 1,
                y: 1
            };
            for (let k = -height; k <= width; k++) {
                const isReverse = (k % 2 !== 0);
                const sign = isReverse ? -1 : 1;
                let len = 0;
                for (let i = (isReverse ? width - 1 : 0); isReverse ? i >= 0 : i < width; i += len * sign) {
                    const j = i - k;
                    if (j < 0 || j > height) {
                        len = 1;
                    } else {
                        const idx = i * 4 + j * width * 4;
                        if (img.bitmap.data[idx] <= bwThreshold) {
                            const start = {
                                x: i,
                                y: j
                            };
                            len = extractSegment(img.bitmap.data, start, img.bitmap, direction, sign);
                            const end = {
                                x: start.x + direction.x * len * sign,
                                y: start.y + direction.y * len * sign
                            };
                            content.push(...genMovement(normalizer, start, end));
                        } else {
                            len = 1;
                        }
                    }
                }
                const p = k / (width + height);
                if (p - progress > 0.05) {
                    progress = p;
                    this.emit('progress', progress);
                }
            }
        }
        content.push('G0 X0 Y0');

        return content;
    }

    async generateGcodeDxf(modelInfo, modelPath) {
        const { transformation, config, gcodeConfigPlaceholder, gcodeConfig } = modelInfo;
        const { fillEnabled, fillDensity, optimizePath } = config;
        const { fixedPowerEnabled, fixedPower } = gcodeConfig;
        const { workSpeed, jogSpeed } = gcodeConfigPlaceholder;
        const originWidth = modelInfo.sourceWidth;
        const originHeight = modelInfo.sourceHeight;
        const targetWidth = transformation.width;
        const targetHeight = transformation.height;
        // rotation: degree and counter-clockwise
        const rotationZ = transformation.rotationZ;
        const flipFlag = transformation.flip;
        let { svg } = await parseDxf(modelPath);
        svg = dxfToSvg(svg);
        updateDxfBoundingBox(svg);
        // flip(svg, 1);
        flip(svg, flipFlag);
        scale(svg, {
            x: targetWidth / originWidth,
            y: targetHeight / originHeight
        });
        if (optimizePath) {
            sortShapes(svg);
        }
        rotate(svg, rotationZ); // rotate: unit is radians and counter-clockwise
        translate(svg, -svg.viewBox[0], -svg.viewBox[1]);


        const normalizer = new Normalizer(
            'Center',
            svg.viewBox[0],
            svg.viewBox[0] + svg.viewBox[2],
            svg.viewBox[1],
            svg.viewBox[1] + svg.viewBox[3],
            {
                x: 1,
                y: 1
            }
        );


        const segments = svgToSegments(svg, {
            width: svg.viewBox[2],
            height: svg.viewBox[3],
            fillEnabled: fillEnabled,
            fillDensity: fillDensity
        });


        let firstTurnOn = true;
        function turnOnLaser() {
            if (firstTurnOn && fixedPowerEnabled) {
                firstTurnOn = false;
                const powerStrength = Math.floor(fixedPower * 255 / 100);
                return `M3 P${fixedPower} S${powerStrength}`;
            }
            return 'M3';
        }

        // second pass generate gcode
        let progress = 0;
        const content = [];
        content.push(`G0 F${jogSpeed}`);
        content.push(`G1 F${workSpeed}`);

        let current = null;

        for (const segment of segments) {
            // G0 move to start
            if (!current || current && !(pointEqual(current, segment.start))) {
                if (current) {
                    content.push('M5');
                }

                // Move to start point
                content.push(`G0 X${normalizer.x(segment.start[0])} Y${normalizer.y(segment.start[1])}`);
                content.push(turnOnLaser());
            }

            // G0 move to end
            content.push(`G1 X${normalizer.x(segment.end[0])} Y${normalizer.y(segment.end[1])}`);

            current = segment.end;

            progress += 1;
        }
        if (segments.length !== 0) {
            progress /= segments.length;
        }
        this.emit('progress', progress);
        // turn off
        if (current) {
            content.push('M5');
        }

        // move to work zero
        content.push('G0 X0 Y0');

        // return `${content.join('\n')}\n`;
        return content;
    }

    async generateGcodeVector(modelInfo, modelPath) {
        const { transformation, config, gcodeConfigPlaceholder, gcodeConfig } = modelInfo;
        const { fillEnabled, fillDensity, optimizePath } = config;
        const { fixedPowerEnabled, fixedPower } = gcodeConfig;
        const { workSpeed, jogSpeed } = gcodeConfigPlaceholder;
        const originWidth = modelInfo.sourceWidth;
        const originHeight = modelInfo.sourceHeight;
        const targetWidth = transformation.width;
        const targetHeight = transformation.height;

        // rotation: degree and counter-clockwise
        const rotationZ = transformation.rotationZ;
        const flipFlag = transformation.flip;

        const svgParser = new SVGParser();


        const svg = await svgParser.parseFile(modelPath);

        flip(svg, 1);
        flip(svg, flipFlag);
        scale(svg, {
            x: targetWidth / originWidth,
            y: targetHeight / originHeight
        });
        if (optimizePath) {
            sortShapes(svg);
        }
        rotate(svg, rotationZ); // rotate: unit is radians and counter-clockwise
        translate(svg, -svg.viewBox[0], -svg.viewBox[1]);


        const normalizer = new Normalizer(
            'Center',
            svg.viewBox[0],
            svg.viewBox[0] + svg.viewBox[2],
            svg.viewBox[1],
            svg.viewBox[1] + svg.viewBox[3],
            {
                x: 1,
                y: 1
            }
        );


        const segments = svgToSegments(svg, {
            width: svg.viewBox[2],
            height: svg.viewBox[3],
            fillEnabled: fillEnabled,
            fillDensity: fillDensity
        });

        let firstTurnOn = true;
        function turnOnLaser() {
            if (firstTurnOn && fixedPowerEnabled) {
                firstTurnOn = false;
                const powerStrength = Math.floor(fixedPower * 255 / 100);
                return `M3 P${fixedPower} S${powerStrength}`;
            }
            return 'M3';
        }

        // second pass generate gcode
        let progress = 0;
        const content = [];
        content.push(`G0 F${jogSpeed}`);
        content.push(`G1 F${workSpeed}`);

        let current = null;
        for (const segment of segments) {
            // G0 move to start
            if (!current || current && !(pointEqual(current, segment.start))) {
                if (current) {
                    content.push('M5');
                }

                // Move to start point
                content.push(`G0 X${normalizer.x(segment.start[0])} Y${normalizer.y(segment.start[1])}`);
                content.push(turnOnLaser());
            }

            // G0 move to end
            content.push(`G1 X${normalizer.x(segment.end[0])} Y${normalizer.y(segment.end[1])}`);

            current = segment.end;

            progress += 1;
        }
        if (segments.length !== 0) {
            progress /= segments.length;
        }
        this.emit('progress', progress);
        // turn off
        if (current) {
            content.push('M5');
        }

        // move to work zero
        content.push('G0 X0 Y0');
        return content;
    }
}

export default LaserToolPathGenerator;
