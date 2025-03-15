/*
Copyright (c) 2025 The Khronos Group Inc.
Use of this source code is governed by an MIT-style license that can be
found in the LICENSE.txt file.
*/

'use strict';

class JSGL {
   static GL = globalThis.WebGL2RenderingContext || WebGLRenderingContext;

   /**
    * @typedef {Float32Array | Int32Array | Uint32Array} Any32Array
    * @typedef {number} GLenum
    */

   /**
    * `=> { throw v; }`
    *
    * Like `throw`, but usable as an expression not just a statement.\
    * E.g. `let found = foo.bar || throwv({foo, msg: 'foo must have .bar!'});`
    * @param {any} v
    * @returns {never}
    */
   static throwv(v) {
      throw v;
   }

   /**
    * @template T
    * @param {T} class_
    * @param {string} method_name
    * @param {object} hooks
    * @param {(this:T,method_name:string,args:any[]) => void} [hooks.fn_before]
    * @param {(this:T,retval,method_name:string,args:any[]) => void} [hooks.fn_after]
    */
   static hook_method(class_, method_name, hooks) {
      const fn_was = class_[method_name];
      if (!fn_was) return false;
      class_[method_name] = function(...args) {
         if (hooks.fn_before) {
            hooks.fn_before.call(this, method_name, ...args);
         }

         const retval = fn_was.call(this, ...args);

         if (hooks.fn_after) {
            hooks.fn_after.call(this, retval, method_name, ...args);
         }

         return retval;
      }
      class_[method_name].name = method_name;
      return true;
   }

   // -

   static BINDING_PNAME_BY_TARGET_PNAME = new Map([
      [this.GL.ARRAY_BUFFER, this.GL.ARRAY_BUFFER_BINDING],
      [this.GL.ELEMENT_ARRAY_BUFFER, this.GL.ELEMENT_ARRAY_BUFFER_BINDING],
      [this.GL.COPY_READ_BUFFER, this.GL.COPY_READ_BUFFER_BINDING],
      [this.GL.COPY_WRITE_BUFFER, this.GL.COPY_WRITE_BUFFER_BINDING],
      [this.GL.TRANSFORM_FEEDBACK_BUFFER, this.GL.TRANSFORM_FEEDBACK_BUFFER_BINDING],
      [this.GL.UNIFORM_BUFFER, this.GL.UNIFORM_BUFFER_BINDING],
      [this.GL.PIXEL_PACK_BUFFER, this.GL.PIXEL_PACK_BUFFER_BINDING],
      [this.GL.PIXEL_UNPACK_BUFFER, this.GL.PIXEL_UNPACK_BUFFER_BINDING],
   ]);

   static get_gl_buffer_by_target(gl, target_pname) {
      const binding_pname = BINDING_PNAME_BY_TARGET_PNAME.get(target_pname);
      const bound = gl.getParameter(binding_pname);
      return bound;
   }

   /** @type {WeakMap<WebGLBuffer, TypedArray>} */
   #cached_data_by_buffer = new WeakMap();

   /**
    * @param {WebGL2RenderingContext} gl
    */
   constructor(gl) {
      const jsgl = this;

      const cached_data_by_buffer = this.#cached_data_by_buffer;

      hook_method(gl, 'bufferData', {
         fn_after: function(ret, method_name, target, srcData, usage, srcOffset, length) {
            srcOffset = srcOffset || 0;
            length = length || 0;

            if (srcData instanceof DataView || srcData instanceof ArrayBuffer) {
               srcData = abv_cast(Uint8Array, srcData);
            } else if (typeof(srcData) == number) {
               srcData = new Uint8Array(srcData);
            }

            let end = undefined;
            if (length) {
               end = srcOffset + length;
            }
            srcData = srcData.subarray(srcOffset, end);
            srcData = abv_cast(Uint8Array, srcData);

            // -

            const buffer = get_gl_buffer_by_target(this, target);
            srcData = srcData.slice(); // Copy!
            cached_data_by_buffer.set(buffer, srcData);
         },
      });

      hook_method(gl, 'bufferSubData', {
         fn_after: function(ret, method_name, target, dstByteOffset, srcData, srcOffset, length) {
            srcOffset = srcOffset || 0;
            length = length || 0;

            if (srcData instanceof DataView || srcData instanceof ArrayBuffer) {
               srcData = abv_cast(Uint8Array, srcData);
            }

            let end = undefined;
            if (length) {
               end = srcOffset + length;
            }
            srcData = srcData.subarray(srcOffset, end);
            srcData = abv_cast(Uint8Array, srcData);

            // -

            const buffer = get_gl_buffer_by_target(this, target);
            const dstData = cached_data_by_buffer.get(buffer);
            if (!dstData) return; // Just get it later.
            dstData.set(srcData, dstByteOffset); // Copies.
         },
      });

      hook_method(gl, 'copyBufferSubData', {
         fn_after: function(ret, method_name, readTarget, writeTarget, readOffset, writeOffset, size) {
            const src = get_gl_buffer_by_target(this, readTarget);
            const dst = get_gl_buffer_by_target(this, writeTarget);
            const srcData = cached_data_by_buffer.get(src);
            const dstData = cached_data_by_buffer.get(dst);
            if (!srcData || !dstData) return;
            dstData.set(srcData.subarray(readOffset, readOffset+size), writeOffset); // Copies.
         },
      });

      hook_method(gl, 'readPixels', {
         fn_after: function() {
            if (!gl.PIXEL_PACK_BUFFER_BINDING) return;
            const buffer = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
            if (!buffer) return;
             // Don't even try. We'll ask for it later.
             cached_data_by_buffer.delete(buffer);
         },
      });

      const BOX = {
         at_risk_of_tf: false,
      };
      hook_method(gl, 'beginTransformFeedback', {
         fn_after: function() {
            BOX.at_risk_of_tf = true;
         },
      });

      const DRAW_CALLS = [
         'drawArrays',
         'drawArraysInstanced',
         'drawElements',
         'drawElementsInstanced',
         'drawRangeElements',
      ];
      DRAW_CALLS.map(
         name => hook_method(gl, name, {
            fn_after: function() {
               if (!BOX.at_risk_of_tf) return;

               const active = gl.getParameter(gl.TRANSFORM_FEEDBACK_ACTIVE);
               const paused = gl.getParameter(gl.TRANSFORM_FEEDBACK_PAUSED);
               if (active && !paused) {
                  const buffer = gl.getParameter(gl.TRANSFORM_FEEDBACK_BUFFER_BINDING);
                  // Don't even try. We'll ask for it later.
                  cached_data_by_buffer.delete(buffer);
               }
            },
         })
      );
   } // constructor


   /** @typedef {(this:DataView,offset:number,littleEndian?:boolean)=>number} DataView_getUint32ish */
   /** @type {Map<string,{bytes_per_channel?:number,bytes_per_pixel?:number, load: DataView_getUint32ish, load_norm?: DataView_getUint32ish>}} */
   static FETCH_INFO_BY_TYPE_NAME = new Map(Object.entries({
      // bytes_per_channel:
      BYTE: {bytes_per_channel: 1, load: DataView.prototype.getInt8, load_norm: DataView.prototype.getSNorm8},
      UNSIGNED_BYTE: {bytes_per_channel: 1, load: DataView.prototype.getUInt8, load_norm: DataView.prototype.getUNorm8},
      SHORT: {bytes_per_channel: 2, load: DataView.prototype.getInt16, load_norm: DataView.prototype.getSNorm16},
      UNSIGNED_SHORT: {bytes_per_channel: 2, load: DataView.prototype.getUInt16, load_norm: DataView.prototype.getUNorm16},
      INT: {bytes_per_channel: 4, load: DataView.prototype.getInt32, load_norm: DataView.prototype.getSNorm32},
      UNSIGNED_INT: {bytes_per_channel: 4, load: DataView.prototype.getUInt32, load_norm: DataView.prototype.getUNorm32},
      HALF_FLOAT: {bytes_per_channel: 2, load: DataView.prototype.getFloat16},
      FLOAT: {bytes_per_channel: 4, load: DataView.prototype.getFloat32},

      // bytes_per_pixel:
      INT_2_10_10_10_REV: {bytes_per_pixel: 4, load: DataView.getInt10_10_10_2, load_norm: DataView.prototype.getSNorm10_10_10_2},
      UNSIGNED_INT_2_10_10_10_REV: {bytes_per_pixel: 4, load: DataView.prototype.getUint10_10_10_2, load_norm: DataView.prototype.getUNorm10_10_10_2},
   }));

   /** @type {Map<GLenum,string>}*/
   static TYPE_NAME_BY_PNAME = new Map();
   static {
      for (const type_name of FETCH_INFO_BY_TYPE_NAME.keys()) {
         const pname = GL[type_name];
         console.assert(pname, {GL, typename, FETCH_INFO_BY_TYPE_NAME});
         type_name_by_pname.set(pname, type_name);
      }
   }

   static WEBGL1_GETVERTEXATTRIB_POLYFILL_BY_NAME = new Map([
      ['VERTEX_ATTRIB_ARRAY_DIVISOR', 0],
      ['VERTEX_ATTRIB_ARRAY_INTEGER', false],
   ]);

   /**
    * @param {WebGLRenderingContext} gl
    * @returns {GlFetchState}
    */
   gl_get_vao_param(gl, i, suffix) {
      const name = `VERTEX_ATTRIB_ARRAY${suffix}`;
      const pname = GL[name] || throwv({suffix, name, GL});
      if (!gl[name]) return WEBGL1_GETVERTEXATTRIB_POLYFILL_BY_NAME.get(name);
      return gl.getVertexAttrib(i, pname);
   }

   /**
    * @typedef {object} GlFetchState
    * @property {Any32Array[]} generic_attribs len: MAX_VERTEX_ATTRIBS
    * @property {GlVaoState} vao
    *
    * @typedef {object} GlVaoState
    * @property {WebGLVertexArray} binding
    * @property {WebGLBuffer} index_buffer ELEMENT_ARRAY_BUFFER_BINDING
    * @property {GlVaoPerAttribState[]} attribs len: MAX_VERTEX_ATTRIBS
    *
    * @typedef {object} GlVaoPerAttribState
    * @property {boolean} is_array VERTEX_ATTRIB_ARRAY_ENABLED
    * @property {number} divisor
    * @property {GlVapState} vap VertexAttribPointer
    *
    * @typedef {object} GlVapState
    * @property {boolean} integer VertexAttribIPointer, vs VertexAttribPointer
    * @property {number} size
    * @property {string} type
    * @property {boolean} normalized
    * @property {number} stride
    * @property {number} offset VERTEX_ATTRIB_ARRAY_POINTER
    * @property {WebGLBuffer} buffer VERTEX_ATTRIB_BUFFER_BINDING
    *
    * @param {WebGLRenderingContext} gl
    * @returns {GlFetchState}
    */
   get_gl_fetch_state(gl) {
      const MAX_VERTEX_ATTRIBS = gl.getParameter(GL.MAX_VERTEX_ATTRIBS);

      let vao_binding = null;
      if (gl.VERTEX_ARRAY_BINDING) {
         vao_binding = gl.getParameter(GL.VERTEX_ARRAY_BINDING);
      }

      return {
         generic_attribs: range(MAX_VERTEX_ATTRIBS).map(
            i => gl.getVertexAttrib(i, GL.CURRENT_VERTEX_ATTRIB)
         ),
         vao: {
            binding: vao_binding,
            index_buffer: gl.getParameter(GL.ELEMENT_ARRAY_BUFFER_BINDING),
            attribs: range(MAX_VERTEX_ATTRIBS).map(
                  i => ({
                     is_array     : gl_get_vao_param(gl, i, '_ENABLED'),
                     divisor      : gl_get_vao_param(gl, i, '_DIVISOR'),
                     vap: {
                        integer   : gl_get_vao_param(gl, i, '_INTEGER'),
                        size      : gl_get_vao_param(gl, i, '_SIZE'),
                        type      : TYPE_NAME_BY_PNAME.get(gl_get_vao_param(gl, i, '_TYPE')),
                        normalized: gl_get_vao_param(gl, i, '_NORMALIZED'),
                        stride    : gl_get_vao_param(gl, i, '_STRIDE'),
                        offset    : gl_get_vao_param(gl, i, '_POINTER'),
                        buffer    : gl_get_vao_param(gl, i, '_BUFFER_BINDING'),
                     },
                  })
            ),
         },
      };
   }

   // -

   /**
    * @param {GlFetchState | WebGLRenderingContext} state_or_gl
    * @param {number[]} attrib_ids
    * @param {number} vert_id
    * @param {number} inst_id
    * @returns {number[4][][]}
    */
   fetch_attribs(state_or_gl, attrib_ids, vert_id, inst_id) {
      if (state_or_gl.getVertexAttrib) {
            state_or_gl = get_fetch_state(state_or_gl);
      }
      /** @type {GlFetchState} */
      const state = state_or_gl;

      return attrib_ids.map(
            attrib_id => jsgl_fetch_attrib(state, attrib_id, vert_id, inst_id)
      )
   }

   // -

   /**
    * @param {GlFetchState | WebGLRenderingContext} state_or_gl
    * @param {number} attrib_id
    * @param {number} vert_id
    * @param {number} inst_id
    * @returns {number[4][]}
    */
   fetch_attrib(state_or_gl, attrib_id, vert_id, inst_id) {
      if (state_or_gl.getVertexAttrib) {
          state_or_gl = get_fetch_state(state_or_gl);
      }
      /** @type {GlFetchState} */
      const state = state_or_gl;

      /** @type {GlVaoPerAttribState} */
      const attrib = state.vao.attrib[attrib_id];

      if (!attrib.is_array) {
          const vals = state.generic_attribs[attrib_id];
          return [vals]; // Exact
      }

      let fetch_id = vert_id;
      if (attrib.divisor) {
          fetch_id = Math.floor(inst_id / attrib.divisor);
      }

      /** @type {GlVapState} */
      const vap = attrib.vap;

      const buffer_data = vap.buffer.data;
      if (!buffer_data.data_view) {
         buffer_data.data_view = as_abv(DataView2, buffer_data);
      }
      const data_view = buffer_data.data_view;

      const fetch_info = FETCH_INFO_BY_TYPE[vap.type] || throwv({FETCH_INFO_BY_TYPE, vap});
      let fn_DataView_load = fetch_info.load;
      let convert_to_f32 = false;
      let possible_f32_quant_error = vap.type.endsWith('INT'); // SHORT and smaller (and Packed) are exact as f32.
      if (vap.integer) {
         possible_f32_quant_error = false;
      } else if (vap.normalized) {
         console.assert(fetch_info.load_norm || vap.type.includes('FLOAT'), {vap, fetch_info});
         fn_DataView_load = fetch_info.load_norm || fn_DataView_load;
         //convert_to_f32 = true; // number -> f32?
         //possible_f32_quant_error = true; // Are we safe?
      } else {
         convert_to_f32 = !vap.type.includes('FLOAT');
      }

      const DATAVIEW_AS_LITTLE_ENDIAN = true;
      const fn_load = byte_offset => fn_DataView_load.call(data_view, byte_offset, DATAVIEW_AS_LITTLE_ENDIAN);

      const num_channels = vap.size; // BTW packed 1010102 is always size:4
      let byte_stride_per_attrib = vap.stride;
      if (!byte_stride_per_attrib) {
          byte_stride_per_attrib = fetch_info.bytes_per_pixel || (fetch_info.bytes_per_channel * num_channels);
      }

      const attrib_byte_offset = vap.offset + fetch_id * byte_stride_per_attrib;
      const DEFAULT_CHANNEL_VALS = [0,0,0,1];
      let load_vals;
      if (!fetch_info.bytes_per_channel) {
          load_vals = fn_load(attrib_byte_offset);
      } else {
          load_vals = range(4).map(
              i => {
                  if (i >= num_channels) return DEFAULT_CHANNEL_VALS[i];
                  const channel_byte_offset = attrib_byte_offset + i*fetch_info.bytes_per_channel;
                  return fn_load(channel_byte_offset);
              }
          );
      }

      let ret = [load_vals];
      if (convert_to_f32 && !(load_vals instanceof Float32Array)) {
          console.assert(load_vals.length = 4);
          const f32s = new Float32Array(4*2); // as [...min, ...max]
          const u32s = abv_cast(Uint32Array, f32s);
          let is_exact = true;
          for (const i in load_vals) {
              const exact = load_vals[i];
              f32s[i] = exact;

              let min_max_delta = 0; // max - min
              if (f32s[i] != exact) {
                  is_exact = false;
                  min_max_delta = Math.sign(exact); // -1 or +1

                  if (f32s[i] > exact) {
                      min_max_delta = -min_max_delta;
                  }
              }
              u32s[4+i] = u32s[i] + min_max_delta;
              console.assert(f32s[i] <= exact, {failed: 'min <= exact', i, exact, f32s});
              console.assert(exact <= f32s[4+i], {failed: 'exact <= max', i, exact, f32s});
          }
          const mins = f32s.subarray(0, 4);
          if (is_exact) {
              ret = [mins];
          } else {
              const maxs = f32s.subarray(4, 4+4);
              ret = [mins, maxs];
          }
      }

      return ret;
  }
}
