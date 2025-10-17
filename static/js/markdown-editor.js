/**
 * Markdown Editor Module
 * Modern WYSIWYG markdown editor using Quill
 */

import { events, EVENT } from './events.js';

class MarkdownEditor {
    constructor() {
        this.container = null;
        this.editor = null;
        this.editorElement = null;
        this.onChangeCallback = null;
        this.isUpdating = false;
        this.currentNoteContent = '';
    }

    async init(containerId, onChange) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error('[MarkdownEditor] Container not found:', containerId);
            return;
        }

        this.onChangeCallback = onChange;
        
        // Don't load Quill yet - wait until actually needed (lazy loading)
        // This saves ~300KB on initial page load
        this.container.innerHTML = '<div style="padding: 1rem; color: var(--bulma-text-light); opacity: 0.6;">Editor loading...</div>';
    }
    
    async ensureQuillLoaded() {
        // Only load Quill when first needed
        if (!this.editor) {
            await this.loadQuill();
            this.render();
            this.initQuill();
        }
    }

    async loadQuill() {
        if (typeof window.Quill !== 'undefined') return;

        // Load Quill CSS locally
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = '/static/vendor/quill/quill.snow.css';
        document.head.appendChild(css);

        // Load Quill JS locally
        const script = document.createElement('script');
        script.src = '/static/vendor/quill/quill.min.js';
        document.head.appendChild(script);

        // Wait for Quill to load
        await new Promise((resolve) => {
            script.onload = resolve;
        });
    }

    render() {
        if (!this.container) return;

        this.container.innerHTML = `
            <div class="quill-editor-wrapper">
                <div id="quill-editor"></div>
            </div>
        `;

        this.editorElement = document.getElementById('quill-editor');
    }

    initQuill() {
        if (!window.Quill) {
            console.error('[MarkdownEditor] Quill not loaded');
            return;
        }

        try {
            this.editor = new window.Quill(this.editorElement, {
                theme: 'snow',
                modules: {
                    toolbar: [
                        [{ 'header': [1, 2, 3, false] }],
                        ['bold', 'italic', 'strike'],
                        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                        ['blockquote', 'code-block'],
                        ['link'],
                        ['clean']
                    ]
                },
                placeholder: 'Start writing your notes...',
                formats: [
                    'bold', 'italic', 'strike',
                    'header',
                    'list',
                    'code-block',
                    'blockquote',
                    'link'
                ]
            });

            // Listen for text changes
            this.editor.on('text-change', () => {
                if (this.isUpdating) return;

                if (this.onChangeCallback) {
                    const markdown = this.getMarkdown();
                    this.onChangeCallback(markdown);
                }
            });

            // Force placeholder to hide on focus when editor is empty
            this.editor.root.addEventListener('focus', () => {
                if (this.editor.getText().trim() === '') {
                    this.editor.root.dataset.placeholder = '';
                }
            });

            // Restore placeholder on blur if editor is still empty
            this.editor.root.addEventListener('blur', () => {
                if (this.editor.getText().trim() === '') {
                    this.editor.root.dataset.placeholder = 'Start writing your notes...';
                }
            });

            // Apply toolbar visibility based on user settings after initialization
            this.applyToolbarVisibility();
        } catch (error) {
            console.error('[MarkdownEditor] Error initializing editor:', error);
        }
    }

    applyToolbarVisibility() {
        // Import state dynamically to avoid circular dependencies
        import('./state.js').then(({ state }) => {
            const settings = state.get('userSettings');
            const showMarkdownEditor = settings.showMarkdownEditor === true;

            const toolbar = this.container?.querySelector('.ql-toolbar');
            if (toolbar) {
                toolbar.style.display = showMarkdownEditor ? '' : 'none';
            }

            // Editor enabled state should be based on context selection only
            // Toolbar visibility is separate from editor interactivity
            if (this.editor) {
                const context = state.get('selectedContext');
                this.editor.enable(context ? true : false);
            }
        });
    }

    getMarkdown() {
        if (!this.editor) return '';

        const delta = this.editor.getContents();
        let markdown = '';
        let currentList = null;
        let listCounter = 0;

        delta.ops.forEach((op, index) => {
            if (!op.insert) return;

            const text = typeof op.insert === 'string' ? op.insert : '';
            const attrs = op.attributes || {};

            // Handle newlines with formatting
            if (text === '\n') {
                // Check for headers
                if (attrs.header) {
                    markdown = markdown.trimEnd();
                    markdown = '#'.repeat(attrs.header) + ' ' + markdown.split('\n').pop();
                    markdown += '\n\n';
                }
                // Check for lists
                else if (attrs.list) {
                    if (attrs.list !== currentList) {
                        currentList = attrs.list;
                        listCounter = 1;
                    }
                    const line = markdown.split('\n').pop();
                    markdown = markdown.substring(0, markdown.lastIndexOf('\n') + 1);

                    if (attrs.list === 'ordered') {
                        markdown += `${listCounter++}. ${line}\n`;
                    } else if (attrs.list === 'bullet') {
                        markdown += `- ${line}\n`;
                    } else if (attrs.list === 'check') {
                        markdown += `- [ ] ${line}\n`;
                    }
                } else {
                    currentList = null;
                    listCounter = 0;
                    if (attrs.blockquote) {
                        const line = markdown.split('\n').pop();
                        markdown = markdown.substring(0, markdown.lastIndexOf('\n') + 1);
                        markdown += `> ${line}\n`;
                    } else if (attrs['code-block']) {
                        markdown += '\n```\n';
                    } else {
                        markdown += '\n';
                    }
                }
            } else {
                let formattedText = text;

                // Apply inline formatting
                if (attrs.bold) {
                    formattedText = `**${formattedText}**`;
                }
                if (attrs.italic) {
                    formattedText = `*${formattedText}*`;
                }
                if (attrs.strike) {
                    formattedText = `~~${formattedText}~~`;
                }
                if (attrs.code) {
                    formattedText = `\`${formattedText}\``;
                }
                if (attrs.link) {
                    formattedText = `[${formattedText}](${attrs.link})`;
                }

                markdown += formattedText;
            }
        });

        return markdown.trim();
    }

    async setContent(content) {
        // Lazy load Quill when content is set
        await this.ensureQuillLoaded();

        if (!this.editor) return;

        this.isUpdating = true;

        try {
            if (!content) {
                this.editor.setText('');
                this.currentNoteContent = '';
            } else {
                // Convert markdown to Quill Delta
                const delta = this.markdownToDelta(content);
                this.editor.setContents(delta);

                // Track the current content for comparison
                this.currentNoteContent = content;
            }

            // Ensure editor is enabled after setting content (if we have a context)
            import('./state.js').then(({ state }) => {
                const context = state.get('selectedContext');
                if (context && this.editor) {
                    // Small delay to ensure Quill has processed the content
                    setTimeout(() => {
                        if (this.editor) {
                            this.editor.enable(true);
                        }
                    }, 0);
                }
            });
        } finally {
            this.isUpdating = false;
        }
    }

    markdownToDelta(markdown) {
        const ops = [];
        const lines = markdown.split('\n');

        lines.forEach((line, index) => {
            // Headers
            const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);
            if (headerMatch) {
                const level = headerMatch[1].length;
                ops.push({ insert: headerMatch[2] });
                ops.push({ insert: '\n', attributes: { header: level } });
                return;
            }

            // Bullet list
            const bulletMatch = line.match(/^-\s+(.+)$/);
            if (bulletMatch) {
                const text = this.parseInlineMarkdown(bulletMatch[1]);
                ops.push(...text);
                ops.push({ insert: '\n', attributes: { list: 'bullet' } });
                return;
            }

            // Numbered list
            const numberedMatch = line.match(/^\d+\.\s+(.+)$/);
            if (numberedMatch) {
                const text = this.parseInlineMarkdown(numberedMatch[1]);
                ops.push(...text);
                ops.push({ insert: '\n', attributes: { list: 'ordered' } });
                return;
            }

            // Task list
            const taskMatch = line.match(/^-\s+\[([ x])\]\s+(.+)$/);
            if (taskMatch) {
                const text = this.parseInlineMarkdown(taskMatch[2]);
                ops.push(...text);
                ops.push({ insert: '\n', attributes: { list: 'check' } });
                return;
            }

            // Blockquote
            const quoteMatch = line.match(/^>\s+(.+)$/);
            if (quoteMatch) {
                const text = this.parseInlineMarkdown(quoteMatch[1]);
                ops.push(...text);
                ops.push({ insert: '\n', attributes: { blockquote: true } });
                return;
            }

            // Code block
            if (line.startsWith('```')) {
                ops.push({ insert: '\n', attributes: { 'code-block': true } });
                return;
            }

            // Regular text with inline formatting
            if (line.trim()) {
                const text = this.parseInlineMarkdown(line);
                ops.push(...text);
            }

            // Add newline if not last line
            if (index < lines.length - 1) {
                ops.push({ insert: '\n' });
            }
        });

        return { ops };
    }

    parseInlineMarkdown(text) {
        const ops = [];
        let remaining = text;

        // Parse inline formatting: bold, italic, strike, code, links
        const regex = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(~~([^~]+)~~)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;
        let lastIndex = 0;
        let match;

        while ((match = regex.exec(text)) !== null) {
            // Add text before match
            if (match.index > lastIndex) {
                ops.push({ insert: text.substring(lastIndex, match.index) });
            }

            // Bold
            if (match[1]) {
                ops.push({ insert: match[2], attributes: { bold: true } });
            }
            // Italic
            else if (match[3]) {
                ops.push({ insert: match[4], attributes: { italic: true } });
            }
            // Strike
            else if (match[5]) {
                ops.push({ insert: match[6], attributes: { strike: true } });
            }
            // Code
            else if (match[7]) {
                ops.push({ insert: match[8], attributes: { code: true } });
            }
            // Link
            else if (match[9]) {
                ops.push({ insert: match[10], attributes: { link: match[11] } });
            }

            lastIndex = regex.lastIndex;
        }

        // Add remaining text
        if (lastIndex < text.length) {
            ops.push({ insert: text.substring(lastIndex) });
        }

        return ops.length > 0 ? ops : [{ insert: text }];
    }

    getContent() {
        return this.getMarkdown();
    }

    async setDisabled(disabled) {
        // Only load editor if we're enabling it
        if (!disabled) {
            await this.ensureQuillLoaded();
        }
        
        if (!this.editor) return;
        this.editor.enable(!disabled);

        const toolbar = this.container?.querySelector('.ql-toolbar');
        if (toolbar) {
            toolbar.style.pointerEvents = disabled ? 'none' : 'auto';
            toolbar.style.opacity = disabled ? '0.5' : '1';
        }

        // Update placeholder based on disabled state
        const editorRoot = this.editor.root;
        if (editorRoot) {
            if (disabled) {
                editorRoot.dataset.placeholder = 'Click "+ New Context" to create your first context and start writing notes...';
            } else {
                editorRoot.dataset.placeholder = 'Start writing your notes...';
            }
        }
    }

    focus() {
        if (this.editor) {
            this.editor.focus();
        }
    }

    /**
     * Force flush any pending changes immediately
     * Used before context/date changes to prevent data loss
     */
    forceFlush() {
        if (!this.editor || this.isUpdating) return;

        const markdown = this.getMarkdown();

        // Clear any pending debounced save
        if (this.onChangeCallback) {
            this.onChangeCallback(markdown);
        }
    }

    /**
     * Check if there are pending changes
     */
    hasPendingChanges() {
        // If there's no editor, no pending changes
        if (!this.editor) return false;

        const currentContent = this.getMarkdown();
        return currentContent !== this.currentNoteContent;
    }
}

export const markdownEditor = new MarkdownEditor();
