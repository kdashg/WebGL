/*
Copyright (c) 2019 The Khronos Group Inc.
Use of this source code is governed by an MIT-style license that can be
found in the LICENSE.txt file.
*/

function generateTest(internalFormat, pixelFormat, pixelType, prologue, resourcePath, defaultContextVersion) {
    var wtu = WebGLTestUtils;
    var tiu = TexImageUtils;
    var gl = null;
    var successfullyParsed = false;
    var imgCanvas;
    var redColor = [255, 0, 0];
    var greenColor = [0, 255, 0];

    function init()
    {
        description('Verify texImage2D and texSubImage2D code paths taking image elements (' + internalFormat + '/' + pixelFormat + '/' + pixelType + ')');

        // Set the default context version while still allowing the webglVersion URL query string to override it.
        wtu.setDefault3DContextVersion(defaultContextVersion);
        gl = wtu.create3DContext("example");

        if (!prologue(gl)) {
            finishTest();
            return;
        }

        switch (gl[pixelFormat]) {
        case gl.RED:
        case gl.RED_INTEGER:
          greenColor = [0, 0, 0];
          break;

        case gl.LUMINANCE:
        case gl.LUMINANCE_ALPHA:
          redColor = [255, 255, 255];
          greenColor = [0, 0, 0];
          break;

        case gl.ALPHA:
          redColor = [0, 0, 0];
          greenColor = [0, 0, 0];
          break;

        default:
          break;
        }

        gl.clearColor(0,0,0,1);
        gl.clearDepth(1);

        (async () => {
            try {
                await runTest();
            } catch (e) {
                testFailed('Unexpected exception: ' + e);
            }
            wtu.glErrorShouldBe(gl, gl.NO_ERROR, "should be no errors");
            finishTest();
        })();
    }

    function runOneIteration(image, testcase, bindingTarget, program) {
        const {flipY, topColor, bottomColor,
            sourceSubRectangle} = testcase;
        const useTexSubImage2D = testcase.sub;

        let sourceSubRectangleString = '';
        if (sourceSubRectangle) {
            sourceSubRectangleString = ' sourceSubRectangle=' + sourceSubRectangle;
        }
        debug('Testing ' +
              ' with ' + image.width + 'x' + image.height + ' bindingTarget=' +
              (bindingTarget == gl.TEXTURE_2D ? 'TEXTURE_2D' : 'TEXTURE_CUBE_MAP') +
              ' and ' + JSON.stringify(testcase));
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        // Disable any writes to the alpha channel
        gl.colorMask(1, 1, 1, 0);
        var texture = gl.createTexture();
        // Bind the texture to texture unit 0
        gl.bindTexture(bindingTarget, texture);
        // Set up texture parameters
        gl.texParameteri(bindingTarget, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(bindingTarget, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        // Set up pixel store parameters
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl[testcase.UNPACK_COLORSPACE_CONVERSION]);
        let pixelMaxError = 0;
        if (testcase.UNPACK_COLORSPACE_CONVERSION != 'NONE') {
            pixelMaxError = 0;
        }
        var targets = [gl.TEXTURE_2D];
        if (bindingTarget == gl.TEXTURE_CUBE_MAP) {
            targets = [gl.TEXTURE_CUBE_MAP_POSITIVE_X,
                       gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
                       gl.TEXTURE_CUBE_MAP_POSITIVE_Y,
                       gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
                       gl.TEXTURE_CUBE_MAP_POSITIVE_Z,
                       gl.TEXTURE_CUBE_MAP_NEGATIVE_Z];
        }
        // Handle the source sub-rectangle if specified (WebGL 2.0 only)
        if (sourceSubRectangle) {
            gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, sourceSubRectangle[0]);
            gl.pixelStorei(gl.UNPACK_SKIP_ROWS, sourceSubRectangle[1]);
        }
        // Upload the image into the texture
        for (var tt = 0; tt < targets.length; ++tt) {
            if (sourceSubRectangle) {
                if (useTexSubImage2D) {
                    // Initialize the texture to black first
                    gl.texImage2D(targets[tt], 0, gl[internalFormat],
                                  sourceSubRectangle[2], sourceSubRectangle[3], 0,
                                  gl[pixelFormat], gl[pixelType], null);
                    gl.texSubImage2D(targets[tt], 0, 0, 0,
                                     sourceSubRectangle[2], sourceSubRectangle[3],
                                     gl[pixelFormat], gl[pixelType], image);
                } else {
                    gl.texImage2D(targets[tt], 0, gl[internalFormat],
                                  sourceSubRectangle[2], sourceSubRectangle[3], 0,
                                  gl[pixelFormat], gl[pixelType], image);
                }
            } else {
                if (useTexSubImage2D) {
                    // Initialize the texture to black first
                    gl.texImage2D(targets[tt], 0, gl[internalFormat], image.width, image.height, 0,
                                  gl[pixelFormat], gl[pixelType], null);
                    gl.texSubImage2D(targets[tt], 0, 0, 0, gl[pixelFormat], gl[pixelType], image);
                } else {
                    gl.texImage2D(targets[tt], 0, gl[internalFormat], gl[pixelFormat], gl[pixelType], image);
                }
            }
        }

        if (sourceSubRectangle) {
            gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
            gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
        }

        var loc;
        if (bindingTarget == gl.TEXTURE_CUBE_MAP) {
            loc = gl.getUniformLocation(program, "face");
        }

        for (var tt = 0; tt < targets.length; ++tt) {
            if (bindingTarget == gl.TEXTURE_CUBE_MAP) {
                gl.uniform1i(loc, targets[tt]);
            }

            // Draw the triangles
            wtu.clearAndDrawUnitQuad(gl, [0, 0, 0, 255]);
            // Check a few pixels near the top and bottom and make sure they have
            // the right color.
            debug("Checking lower left corner");
            wtu.checkCanvasRect(gl, 4, 4, 2, 2, bottomColor,
                                "shouldBe " + bottomColor, pixelMaxError);
            debug("Checking upper left corner");
            wtu.checkCanvasRect(gl, 4, gl.canvas.height - 8, 2, 2, topColor,
                                "shouldBe " + topColor, pixelMaxError);
        }
    }

    async function runTestOnImage(image) {
        var cases = [
            { sub: false, flipY: true, topColor: redColor, bottomColor: greenColor },
            { sub: false, flipY: false, topColor: greenColor, bottomColor: redColor },
            { sub: true, flipY: true, topColor: redColor, bottomColor: greenColor },
            { sub: true, flipY: false, topColor: greenColor, bottomColor: redColor },
        ];


        if (wtu.getDefault3DContextVersion() > 1) {
            cases = cases.concat([
                { sub: false, flipY: false, topColor: redColor, bottomColor: redColor,
                  sourceSubRectangle: [0, 0, 1, 1] },
                { sub: false, flipY: true, topColor: greenColor, bottomColor: greenColor,
                  sourceSubRectangle: [0, 0, 1, 1] },
                { sub: false, flipY: false, topColor: greenColor, bottomColor: greenColor,
                  sourceSubRectangle: [0, 1, 1, 1] },
                { sub: false, flipY: true, topColor: redColor, bottomColor: redColor,
                  sourceSubRectangle: [0, 1, 1, 1] },
                { sub: true, flipY: false, topColor: redColor, bottomColor: redColor,
                  sourceSubRectangle: [0, 0, 1, 1] },
                { sub: true, flipY: true, topColor: greenColor, bottomColor: greenColor,
                  sourceSubRectangle: [0, 0, 1, 1] },
                { sub: true, flipY: false, topColor: greenColor, bottomColor: greenColor,
                  sourceSubRectangle: [0, 1, 1, 1] },
                { sub: true, flipY: true, topColor: redColor, bottomColor: redColor,
                  sourceSubRectangle: [0, 1, 1, 1] },
            ]);
        }

        cases = crossCombine(cases,
            ['NONE', 'BROWSER_DEFAULT_WEBGL'].map(v => ({UNPACK_COLORSPACE_CONVERSION: v}))
        );

        var program = tiu.setupTexturedQuad(gl, internalFormat);
        for (const testcase of cases) {
            runOneIteration(image, testcase,
                            gl.TEXTURE_2D, program);
            await wtu.dispatchPromise();
        }
        // cube map texture must be square.
        if (image.width != image.height)
            return;
        // Skip sub-rectangle tests for cube map textures for the moment.
        program = tiu.setupTexturedQuadWithCubeMap(gl, internalFormat);
        for (const testcase of cases) {
            if (!testcase.sourceSubRectangle) {
                runOneIteration(image, testcase,
                                gl.TEXTURE_CUBE_MAP, program);
            }
            await wtu.dispatchPromise();
        }
    }

    async function runTest() {
        debug("")
        debug("==================================")
        debug("Image from png")
        debug("")

        let image = new Image();
        image.src = resourcePath + "red-green.png";
        try {
            await image.decode();
        } catch (e) {
            testFailed("Creating Image from png failed. src: " + image.src + ", e: " + e);
            return;
        }
        await runTestOnImage(image);

        // -

        debug("")
        debug("==================================")
        debug("Image from canvas2d")
        debug("")


        imgCanvas = document.createElement("canvas");
        imgCanvas.width = 2;
        imgCanvas.height = 2;
        var imgCtx = imgCanvas.getContext("2d");
        var imgData = imgCtx.createImageData(2, 2);
        imgData.data[0] = redColor[0];
        imgData.data[1] = redColor[1];
        imgData.data[2] = redColor[2];
        imgData.data[3] = 255;
        imgData.data[4] = redColor[0];
        imgData.data[5] = redColor[1];
        imgData.data[6] = redColor[2];
        imgData.data[7] = 255;
        imgData.data[8] = greenColor[0];
        imgData.data[9] = greenColor[1];
        imgData.data[10] = greenColor[2];
        imgData.data[11] = 255;
        imgData.data[12] = greenColor[0];
        imgData.data[13] = greenColor[1];
        imgData.data[14] = greenColor[2];
        imgData.data[15] = 255;
        imgCtx.putImageData(imgData, 0, 0);

        image =  new Image();
        image.onload = () => {};
        image.onerror = () => {};
        image.src = imgCanvas.toDataURL();
        try {
            await image.decode();
        } catch (e) {
            testFailed("Creating Image from canvas failed. src: " + image.src + ", e: " + e);
            return;
        }
        await runTestOnImage(image);

        // -
        // apparently Image is different than <img>.

        debug("")
        debug("==================================")
        debug("&lt;img&gt; from canvas2d")
        debug("")

        image = document.createElement('img');
        image.onload = () => {};
        image.onerror = () => {};
        image.src = imgCanvas.toDataURL();
        try {
            await image.decode();
        } catch (e) {
            testFailed("Creating <img>> from canvas failed. src: " + image.src + ", e: " + e);
            return;
        }
        await runTestOnImage(image);
    }

    return init;
}
