import { h } from 'vue'
import { VPCarbon } from 'vitepress-carbon'
import './custom.css'
import ForkBanner from './ForkBanner.vue'

const Layout = {
  setup() {
    return () => [h(ForkBanner), h(VPCarbon.Layout)]
  }
}

export default {
  ...VPCarbon,
  Layout,
}
