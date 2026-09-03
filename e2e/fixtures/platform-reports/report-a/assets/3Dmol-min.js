window.$3Dmol = {
  createViewer(element) {
    return {
      render() {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 180;
        canvas.setAttribute("aria-label", "3D 分子夹具");
        element.appendChild(canvas);
      },
    };
  },
};
