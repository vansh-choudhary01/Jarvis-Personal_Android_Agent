import type {ScreenState} from './protocol.js';

export interface ScreenElement {
  label: string;
  className: string;
  bounds: [number, number, number, number];
  packageName: string;
}

export interface ScreenModel {
  packageName: string;
  title: string;
  buttons: ScreenElement[];
  textFields: ScreenElement[];
  text: string[];
  lists: ScreenElement[];
  dialogs: ScreenElement[];
  scrollable: boolean;
  clickableCount: number;
  editableCount: number;
  nodeCount: number;
  summary: string;
}

export class ScreenObserver {
  observe(screen: ScreenState): ScreenModel {
    const textNodes = screen.nodeTree
      .map(node => ({
        label: cleanLabel(node.text || node.contentDescription || ''),
        className: node.className,
        bounds: node.bounds,
        packageName: node.packageName || screen.packageName,
        clickable: node.clickable,
        editable: node.editable,
      }))
      .filter(node => node.label);

    const buttons = textNodes
      .filter(node => node.clickable || looksLikeButton(node.className))
      .map(toElement)
      .slice(0, 40);

    const textFields = textNodes
      .filter(node => node.editable || looksLikeTextField(node.className))
      .map(toElement)
      .slice(0, 20);

    const lists = textNodes
      .filter(node => looksLikeList(node.className))
      .map(toElement)
      .slice(0, 10);

    const dialogs = textNodes
      .filter(node => looksLikeDialog(node.className))
      .map(toElement)
      .slice(0, 10);

    const visibleText = [...new Set(textNodes.map(node => node.label))]
      .filter(label => label.length <= 120)
      .slice(0, 80);

    const title = inferTitle(visibleText, screen.packageName);
    const scrollable = screen.nodeTree.some(node => /ScrollView|RecyclerView|ListView|ViewPager/i.test(node.className));
    const clickableCount = screen.nodeTree.filter(node => node.clickable).length;
    const editableCount = screen.nodeTree.filter(node => node.editable).length;

    return {
      packageName: screen.packageName,
      title,
      buttons,
      textFields,
      text: visibleText,
      lists,
      dialogs,
      scrollable,
      clickableCount,
      editableCount,
      nodeCount: screen.nodeTree.length,
      summary: summarizeScreen(title, buttons, textFields, visibleText, scrollable),
    };
  }
}

function toElement(node: {
  label: string;
  className: string;
  bounds: [number, number, number, number];
  packageName: string;
}): ScreenElement {
  return {
    label: node.label,
    className: shortClassName(node.className),
    bounds: node.bounds,
    packageName: node.packageName,
  };
}

function inferTitle(text: string[], packageName: string): string {
  const meaningful = text.find(label =>
    label.length >= 3 &&
    label.length <= 48 &&
    !/^(back|search|more options|close|done|cancel|ok)$/i.test(label),
  );
  return meaningful || packageName || 'Unknown screen';
}

function summarizeScreen(
  title: string,
  buttons: ScreenElement[],
  textFields: ScreenElement[],
  text: string[],
  scrollable: boolean,
): string {
  const parts = [`title=${title}`];
  if (buttons.length) parts.push(`buttons=${buttons.slice(0, 8).map(button => button.label).join(', ')}`);
  if (textFields.length) parts.push(`fields=${textFields.slice(0, 5).map(field => field.label).join(', ')}`);
  if (!buttons.length && !textFields.length && text.length) parts.push(`text=${text.slice(0, 8).join(', ')}`);
  if (scrollable) parts.push('scrollable=true');
  return parts.join(' | ');
}

function cleanLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function looksLikeButton(className: string): boolean {
  return /Button|ImageButton|CheckedTextView|Switch|CheckBox|RadioButton/i.test(className);
}

function looksLikeTextField(className: string): boolean {
  return /EditText|TextInput/i.test(className);
}

function looksLikeList(className: string): boolean {
  return /RecyclerView|ListView|GridView/i.test(className);
}

function looksLikeDialog(className: string): boolean {
  return /Dialog|Popup|BottomSheet/i.test(className);
}

function shortClassName(value: string): string {
  const parts = value.split('.');
  return parts[parts.length - 1] || value;
}
