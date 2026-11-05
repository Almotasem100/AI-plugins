window.__ModuleLoader__.load({
  id: '@local/donald-duck',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const duckImage = 'data:image/png;base64,__DUCK_PNG_BASE64__';
    const duckStyles = `
      @keyframes donald-duck-glide {
        from { offset-distance: 0%; }
        to { offset-distance: 100%; }
      }
      @keyframes donald-duck-bob {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-3px); }
      }
      .donald-duck-flight {
        position: fixed;
        z-index: 20;
        top: 0;
        left: 0;
        width: 88px;
        height: 102px;
        offset-path: inset(12% 7% round 42%);
        offset-rotate: 0deg;
        animation: donald-duck-glide 52s linear infinite;
        pointer-events: auto;
        cursor: grab;
        touch-action: none;
        user-select: none;
        filter: drop-shadow(0 3px 5px rgb(0 0 0 / 18%));
      }
      .donald-duck-flight.is-dragging { cursor: grabbing; }
      .donald-duck-flight.is-placed {
        offset-path: none;
        animation: none;
      }
      .donald-duck-bob {
        transform-origin: center;
        animation: donald-duck-bob 2.2s ease-in-out infinite;
      }
      .donald-duck-image {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
        pointer-events: none;
      }
      @media (prefers-reduced-motion: reduce) {
        .donald-duck-flight, .donald-duck-bob { animation: none; }
      }
    `;

    function SailorDuck() {
      const [placement, setPlacement] = React.useState(null);
      const [dragging, setDragging] = React.useState(false);
      const drag = React.useRef(null);
      const duckElement = React.useRef(null);

      function boundedPlacement(x, y) {
        const bounds = duckElement.current.getBoundingClientRect();
        const maxX = Math.max(0, window.innerWidth - bounds.width);
        const maxY = Math.max(0, window.innerHeight - bounds.height);
        return {
          x: Math.min(maxX, Math.max(0, x)),
          y: Math.min(maxY, Math.max(0, y)),
        };
      }

      function moveWithKeyboard(event) {
        const directions = {
          ArrowLeft: [-1, 0], ArrowRight: [1, 0],
          ArrowUp: [0, -1], ArrowDown: [0, 1],
        };
        const direction = Object.hasOwn(directions, event.key) ? directions[event.key] : null;
        if (!direction || drag.current) return;
        event.preventDefault();
        const bounds = duckElement.current.getBoundingClientRect();
        const step = event.shiftKey ? 30 : 10;
        setPlacement(boundedPlacement(bounds.left + direction[0] * step, bounds.top + direction[1] * step));
      }

      function startDrag(event) {
        if (drag.current || event.button !== 0) return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        drag.current = {
          pointerId: event.pointerId,
          offsetX: event.clientX - bounds.left,
          offsetY: event.clientY - bounds.top,
        };
        setPlacement({ x: bounds.left, y: bounds.top });
        setDragging(true);
      }

      React.useEffect(() => {
        function moveDrag(event) {
          if (!drag.current || drag.current.pointerId !== event.pointerId) return;
          if (event.buttons === 0) {
            cancelDrag();
            return;
          }
          setPlacement(boundedPlacement(event.clientX - drag.current.offsetX, event.clientY - drag.current.offsetY));
        }

        function stopDrag(event) {
          if (!drag.current || drag.current.pointerId !== event.pointerId) return;
          cancelDrag();
        }

        function cancelDrag() {
          drag.current = null;
          setDragging(false);
        }

        function keepVisible() {
          setPlacement(current => current ? boundedPlacement(current.x, current.y) : current);
        }

        window.addEventListener('pointermove', moveDrag);
        window.addEventListener('pointerup', stopDrag);
        window.addEventListener('pointercancel', stopDrag);
        window.addEventListener('blur', cancelDrag);
        window.addEventListener('resize', keepVisible);
        return () => {
          window.removeEventListener('pointermove', moveDrag);
          window.removeEventListener('pointerup', stopDrag);
          window.removeEventListener('pointercancel', stopDrag);
          window.removeEventListener('blur', cancelDrag);
          window.removeEventListener('resize', keepVisible);
        };
      }, []);

      const placementStyle = placement ? {
        left: `${placement.x}px`,
        top: `${placement.y}px`,
        offsetPath: 'none',
      } : undefined;

      return h(React.Fragment, null,
        h('style', null, duckStyles),
        h('div', {
          className: `donald-duck-flight${placement ? ' is-placed' : ''}${dragging ? ' is-dragging' : ''}`,
          ref: duckElement,
          style: placementStyle,
          onPointerDown: startDrag,
          onKeyDown: moveWithKeyboard,
          tabIndex: 0,
          role: 'group',
          'aria-roledescription': 'movable character',
          'aria-label': 'Move Donald Duck: drag with the mouse or use arrow keys; hold Shift for larger steps',
        },
          h('img', {
            className: 'donald-duck-bob donald-duck-image',
            src: duckImage,
            alt: '',
            draggable: false,
          })
        )
      );
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'donald-duck', order: 50,
        }, SailorDuck));
      },
    };
  },
});
