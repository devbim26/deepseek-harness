/** A main panel that hosts the custom-agent manager entry through its Factory. */
window.__ModuleLoader__.load({
  id: '@fixture/custom-agents-host',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'custom-agents-host' }, ({ renderFactorySlot }) =>
          h('header', { 'data-fixture-agents-host': '' },
            h('h1', null, 'Agents host'),
            renderFactorySlot('customAgents.createButton', {}))))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: 'custom-agents-host', order: 31, label: () => 'Agents host',
        }, () => h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
          h('circle', { cx: 8, cy: 8, r: 6, fill: 'currentColor' }))))
      },
    }
  },
})
