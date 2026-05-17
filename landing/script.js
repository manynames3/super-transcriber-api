const tabButtons = Array.from(document.querySelectorAll(".tab-button"));
const codeBlocks = Array.from(document.querySelectorAll(".code-block"));

function selectTab(tabName) {
  for (const button of tabButtons) {
    const selected = button.dataset.tab === tabName;
    button.setAttribute("aria-selected", String(selected));
  }

  for (const block of codeBlocks) {
    const selected = block.id === `panel-${tabName}`;
    block.hidden = !selected;
    block.classList.toggle("active", selected);
  }
}

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    if (button.dataset.tab) {
      selectTab(button.dataset.tab);
    }
  });
}
