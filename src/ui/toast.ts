export const TOAST_STYLE = String.raw`.local-toast-stack{position:fixed;right:16px;bottom:16px;z-index:100;display:flex;flex-direction:column;gap:8px;max-width:min(380px,calc(100vw - 32px));pointer-events:none}.local-toast{display:flex;align-items:start;gap:12px;padding:12px 16px;border:1px solid var(--qb-border);border-radius:var(--qb-radius-lg);background:var(--qb-surface);color:var(--qb-fg);box-shadow:var(--qb-shadow);pointer-events:auto;overflow-wrap:anywhere;white-space:pre-wrap}.local-toast.error{border-color:var(--qb-danger)}.local-toast button{height:auto;min-height:24px;padding:0 4px;border:0;background:transparent;color:inherit}.local-toast span{min-width:0;flex:1}@media(max-width:600px),(pointer:coarse){.local-toast button{min-width:var(--qb-touch-min);min-height:var(--qb-touch-min)}}@media(max-width:600px){.local-toast-stack{top:16px;bottom:auto;left:16px;right:16px;max-width:none}}`;
export const TOAST_SCRIPT = String.raw`
function createToast(bridge) {
    let stack;

    return (message, error = false) => {
        if (bridge.embedded) {
            bridge.toast(message, error ? 'error' : 'success');

            return;
        }

        if (!stack) {
            stack = document.createElement('div');
            stack.id = 'local-toasts';
            stack.className = 'local-toast-stack';
            document.body.append(stack);
        }

        while (stack.children.length >= 4) { stack.firstElementChild.remove(); }

        const toast = document.createElement('div'), text = document.createElement('span'), close = document.createElement('button');
        toast.className = 'local-toast' + (error ? ' error' : '');
        toast.setAttribute('role', 'status');
        text.textContent = message;
        close.textContent = '×';
        close.setAttribute('aria-label', '关闭提醒');
        const remove = () => toast.remove();
        close.onclick = remove;
        toast.append(text, close);
        stack.append(toast);
        setTimeout(remove, error ? 6000 : 3000);
    };
}
`;
