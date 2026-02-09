/**
 * Test file to verify Parcel transformer compiles .diamond.html files
 */

// Import the compiled template module
import * as CounterTemplate from './Counter.diamond.html'

console.log('Counter template module:', CounterTemplate)
console.log('createTemplate function:', CounterTemplate.createTemplate)

// Verify the template function exists and works
if (typeof CounterTemplate.createTemplate === 'function') {
  console.log('Template compilation verified!')
} else {
  console.error('Template compilation failed - createTemplate is not a function')
}
