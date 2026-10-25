// 只观察插件内容；显式上报高度，避免把宿主当前视口计入短页内容。
export const PAGE_LAYOUT_SCRIPT = String.raw`
document.documentElement.dataset.embedded = String(bridge.embedded);

if (bridge.embedded) {
    const content = document.querySelector('main');
    let height = 0, frame;
    const resize = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
            const measured = Math.ceil(content.getBoundingClientRect().height);
            // 当前宿主最高 4000px；高度过渡期间仅由父页滚动，超限后保留内页滚动。
            document.documentElement.classList.toggle('page-scroll', measured > 4000);

            if (measured !== height) {
                height = measured;
                bridge.resize(height);
            }
        });
    };
    new ResizeObserver(resize).observe(content);
}
`;
