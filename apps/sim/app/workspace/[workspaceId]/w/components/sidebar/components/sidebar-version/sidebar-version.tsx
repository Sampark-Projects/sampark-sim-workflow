const APP_VERSION = '1.0.0'

/**
 * Release version pinned to the foot of the workspace sidebar.
 *
 * A `p`, not a `span`: globals fade every `span` in the collapsed rail to
 * `opacity: 0`, and the version should stay readable there. Collapsed, the label
 * drops its gutters and centers, because the rail's 48px minus two 8px gutters
 * leaves 32px — a hair narrower than the text.
 */
export function SidebarVersion() {
  return (
    <div className='shrink-0 px-2 pb-2 group-data-[collapsed]/rail:px-0'>
      <p className='whitespace-nowrap px-2 text-[var(--text-muted)] text-micro leading-4 group-data-[collapsed]/rail:px-0 group-data-[collapsed]/rail:text-center'>
        v{APP_VERSION}
      </p>
    </div>
  )
}
