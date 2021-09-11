import autoExternal from 'rollup-plugin-auto-external';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import { terser } from 'rollup-plugin-terser';

export default [
  {
	  input: 'src/main.mjs',
	  output: {
	  	file: 'dist/main.mjs',
	  	format: 'es',
	  	sourcemap: true
	  },
	  plugins: [
	  	//resolve({
      //  only: [/^\.{0,2}\//],
      //}), // tells Rollup how to find date-fns in node_modules
      autoExternal(),
      //gyp(),
	  	terser(), // minify, but only in production
      commonjs({
        transformMixedEsModules: true,
      }),
      json(),
	  ],
  }
];
