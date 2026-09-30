/** Fixture route map whose component imports a *.diamond.html template (#10). */
import type { RouteMap } from '@diamondjs/runtime'
import { HomePage } from './pages/home'

export const routes = {
  home: { path: '/', component: HomePage, outlet: 'main' },
} satisfies RouteMap
