import { observer } from "mobx-react";
import * as React from "react";
import { mergeRefs } from "react-merge-refs";
import styled, { css } from "styled-components";
import { hideScrollbars } from "@shared/styles";

type Props = React.HTMLAttributes<HTMLDivElement> & {
  /** Whether to show shadows at top and bottom when scrolled */
  shadow?: boolean;
  /** Whether to show shadow at the top when scrolled */
  topShadow?: boolean;
  /** Whether to show shadow at the bottom when scrolled */
  bottomShadow?: boolean;
  /** Whether to hide the scrollbars */
  hiddenScrollbars?: boolean;
  /** Color to fade to (enables fade effect), applied to both edges unless topShadow or bottomShadow narrows it to one */
  fadeTo?: string;
  /** Whether to use flexbox layout */
  flex?: boolean;
  /** Custom overflow style */
  overflow?: string;
};

/**
 * A scrollable container component with optional shadow indicators and custom scrollbar styling.
 *
 * @param props - component properties.
 * @param ref - forwarded ref to the scrollable div element.
 * @returns the scrollable container element.
 */
function Scrollable(
  {
    shadow,
    topShadow,
    bottomShadow,
    hiddenScrollbars,
    fadeTo,
    flex,
    overflow,
    children,
    ...rest
  }: Props,
  ref: React.Ref<HTMLDivElement>
) {
  const localRef = React.useRef<HTMLDivElement>(null);
  const [topShadowVisible, setTopShadow] = React.useState(false);
  const [bottomShadowVisible, setBottomShadow] = React.useState(false);

  // When an edge is named alongside fadeTo the fade is limited to that edge,
  // otherwise both edges fade.
  const singleEdge = topShadow !== undefined || bottomShadow !== undefined;
  const fadeTop = !!fadeTo && (!singleEdge || !!topShadow);
  const fadeBottom = !!fadeTo && (!singleEdge || !!bottomShadow);
  const trackTop = !!(shadow || topShadow || fadeTop);
  const trackBottom = !!(shadow || bottomShadow || fadeBottom);

  // Last seen container metrics so repeated scroll/resize events that do not
  // change the geometry skip state updates entirely.
  const metrics = React.useRef({
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    trackTop: false,
    trackBottom: false,
  });
  const frame = React.useRef<number>();
  const settleTimeout = React.useRef<ReturnType<typeof setTimeout>>();

  const updateShadows = React.useCallback(() => {
    const c = localRef.current;
    if (!c) {
      return;
    }

    const scrollTop = c.scrollTop;
    const scrollHeight = c.scrollHeight;
    const clientHeight = c.clientHeight;

    const previous = metrics.current;
    if (
      previous.scrollTop === scrollTop &&
      previous.scrollHeight === scrollHeight &&
      previous.clientHeight === clientHeight &&
      previous.trackTop === trackTop &&
      previous.trackBottom === trackBottom
    ) {
      return;
    }
    metrics.current = {
      scrollTop,
      scrollHeight,
      clientHeight,
      trackTop,
      trackBottom,
    };

    setTopShadow(trackTop && scrollTop > 0);

    const wrapperHeight = c.scrollHeight - c.clientHeight;
    setBottomShadow(trackBottom && wrapperHeight - scrollTop > 1);
  }, [trackTop, trackBottom]);

  // Batch updates to one animation frame, with a trailing call after scrolling
  // stops so the edge shadows settle at their final position.
  const requestUpdateShadows = React.useCallback(() => {
    if (settleTimeout.current) {
      clearTimeout(settleTimeout.current);
    }
    settleTimeout.current = setTimeout(() => {
      settleTimeout.current = undefined;
      updateShadows();
    }, 100);

    if (frame.current !== undefined) {
      return;
    }

    frame.current = requestAnimationFrame(() => {
      frame.current = undefined;
      updateShadows();
    });
  }, [updateShadows]);

  React.useEffect(() => {
    const c = localRef.current;
    if (!c) {
      return;
    }

    updateShadows();

    const observer = new ResizeObserver(requestUpdateShadows);
    observer.observe(c);

    for (const child of Array.from(c.children)) {
      observer.observe(child);
    }

    return () => {
      observer.disconnect();
      if (frame.current !== undefined) {
        cancelAnimationFrame(frame.current);
        frame.current = undefined;
      }
      if (settleTimeout.current) {
        clearTimeout(settleTimeout.current);
        settleTimeout.current = undefined;
      }
    };
  }, [updateShadows, requestUpdateShadows]);

  return (
    <Wrapper
      ref={mergeRefs([localRef, ref])}
      onScroll={requestUpdateShadows}
      $flex={flex}
      $hiddenScrollbars={hiddenScrollbars}
      $topShadowVisible={topShadowVisible && !fadeTop}
      $bottomShadowVisible={bottomShadowVisible && !fadeBottom}
      $overflow={overflow}
      {...rest}
    >
      {fadeTo && fadeTop && <Fade to={fadeTo} visible={topShadowVisible} top />}
      {children}
      {fadeTo && fadeBottom && (
        <Fade to={fadeTo} visible={bottomShadowVisible} bottom />
      )}
    </Wrapper>
  );
}

const Fade = styled.div<{
  to: string;
  top?: boolean;
  bottom?: boolean;
  visible: boolean;
}>`
  --height: 1.5em;
  position: sticky;
  ${(props) =>
    props.top &&
    css`
      top: 0;
      background: linear-gradient(to bottom, ${props.to}, transparent);
      margin-bottom: calc(-1 * var(--height));
    `}
  ${(props) =>
    props.bottom &&
    css`
      bottom: 0;
      background: linear-gradient(to top, ${props.to}, transparent);
      margin-top: calc(-1 * var(--height));
    `}

  flex-shrink: 0;
  height: var(--height);
  width: calc(100% - var(--scrollbar-width, 0px));
  pointer-events: none;
  opacity: ${(props) => (props.visible ? 1 : 0)};
  transition: opacity 100ms ease-in-out;
  z-index: 1;
`;

const Wrapper = styled.div<{
  $flex?: boolean;
  $fadeTo?: string;
  $topShadowVisible?: boolean;
  $bottomShadowVisible?: boolean;
  $hiddenScrollbars?: boolean;
  $overflow?: string;
}>`
  position: relative;
  display: ${(props) => (props.$flex ? "flex" : "block")};
  flex-direction: column;
  height: 100%;
  overflow-y: ${(props) => (props.$overflow ? props.$overflow : "auto")};
  overflow-x: ${(props) => (props.$overflow ? props.$overflow : "hidden")};
  overscroll-behavior: none;
  -webkit-overflow-scrolling: touch;
  box-shadow: ${(props) => {
    if (props.$topShadowVisible && props.$bottomShadowVisible) {
      return "0 1px inset rgba(0,0,0,.1), 0 -1px inset rgba(0,0,0,.1)";
    }

    if (props.$topShadowVisible) {
      return "0 1px inset rgba(0,0,0,.1)";
    }

    if (props.$bottomShadowVisible) {
      return "0 -1px inset rgba(0,0,0,.1)";
    }

    return "none";
  }};
  transition: box-shadow 100ms ease-in-out;

  ${(props) => props.$hiddenScrollbars && hideScrollbars()}
`;

export default observer(React.forwardRef(Scrollable));
