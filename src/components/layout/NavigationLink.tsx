import { forwardRef, useEffect, useRef } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { prepareNavigation } from '../../navigation/prepareNavigation';

/** Every sidebar depth and quick action gets the same pointer/keyboard/touch preparation. */
const NavigationLink = forwardRef<HTMLAnchorElement, LinkProps>((props, ref) => {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const href = typeof props.to === 'string' ? props.to : `${props.to.pathname || ''}${props.to.search || ''}`;
  const cancel = () => { if (timer.current) clearTimeout(timer.current); };
  useEffect(() => cancel, []);
  return <Link {...props} ref={ref} data-navigation-path={href}
    onMouseEnter={event => { props.onMouseEnter?.(event); cancel(); prepareNavigation(href, false); timer.current = setTimeout(() => prepareNavigation(href), 80); }}
    onMouseLeave={event => { props.onMouseLeave?.(event); cancel(); }}
    onFocus={event => { props.onFocus?.(event); prepareNavigation(href); }}
    onPointerDown={event => { props.onPointerDown?.(event); cancel(); prepareNavigation(href); }}
    onClick={event => { props.onClick?.(event); if (!event.defaultPrevented) { cancel(); prepareNavigation(href); } }}
  />;
});
NavigationLink.displayName = 'NavigationLink';
export default NavigationLink;
