/** Fixture page: the recommended layout — component + compiled template + styles. */
import { Component } from '@diamondjs/runtime'
import * as T from './home.diamond.html'
import './home.css'

export class HomePage extends Component {
  title = 'Home'
  createTemplate = (T as unknown as { createTemplate: (this: HomePage) => HTMLElement }).createTemplate
}
