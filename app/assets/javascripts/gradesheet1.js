jQuery.noConflict();
jQuery(function() {
    start = new Date();

    var TAB_KEY = 9;
    var ENTER_KEY = 13;

    var current_editor = undefined;
    var current_popover = undefined;

    var num_cols = jQuery("table#grades > thead > tr:first > th").length

    numeric_columns = []
    for (var i = first_problem_column; i < num_cols; i++)
        numeric_columns.push(i);

    non_searchable_columns = []
    for (var i = first_non_searchable_column; i < num_cols; i++)
      non_searchable_columns.push(i);

    jQuery.ajaxSetup({
      headers: {
          'X-CSRF-Token' : $('meta[name="csrf-token"]').attr('content')
      },
    });

    // fast numeric-html sorts (but --'s aren't sorted correctly)
    jQuery.extend(jQuery.fn.dataTableExt.oSort, {
      "num-html-pre": function (a) {
        return parseFloat(String(a).replace(/<[\s\S]*?>/g, ""));
      },
   
      "num-html-asc": function ( a, b ) {
        a_nan = isNaN(a);
        b_nan = isNaN(b);
        if (a_nan) {
          if (b_nan) { return 0; } else { return -1; }
        } else {
          if (b_nan) { return 1; } else {
            return ((a < b) ? -1 : ((a > b) ? 1 : 0));
          }
        }
      },
   
      "num-html-desc": function ( a, b ) {
        a_nan = isNaN(a);
        b_nan = isNaN(b);
        if (a_nan) {
          if (b_nan) { return 0; } else { return 1; }
        } else {
          if (b_nan) { return -1; } else {
            return ((a > b) ? -1 : ((a < b) ? 1 : 0));
          }
        }
      }
    } );

    // from http://www.datatables.net/plug-ins/api. ugly, but for now...
    jQuery.fn.dataTableExt.oApi.fnSetFilteringDelay = function ( oSettings, iDelay ) {
        var _that = this;
     
        if ( iDelay === undefined ) {
            iDelay = 250;
        }
          
        this.each( function ( i ) {
            jQuery.fn.dataTableExt.iApiIndex = i;
            var
                $this = this,
                oTimerId = null,
                sPreviousSearch = null,
                anControl = jQuery( 'input', _that.fnSettings().aanFeatures.f );
              
                anControl.unbind( 'keyup' ).bind( 'keyup', function() {
                var $$this = $this;
      
                if (sPreviousSearch === null || sPreviousSearch != anControl.val()) {
                    window.clearTimeout(oTimerId);
                    sPreviousSearch = anControl.val(); 
                    oTimerId = window.setTimeout(function() {
                        jQuery.fn.dataTableExt.iApiIndex = i;
                        _that.fnFilter( anControl.val() );
                    }, iDelay);
                }
            });
              
            return this;
        } );
        return this;
    };

    // main score table
    var oTable = jQuery("#grades").dataTable({
        'sDom' : '<"tools"f>t', // '<"tools"fC>t', for individual problem column hide/show
        'bPaginate': false,
        'bInfo': false,
        'oLanguage': { "sSearch": "" },
        'iTabIndex': -1,
        'aoColumnDefs': [
          { "bSortable": false, "aTargets": [ 0 ] },
          { "bSearchable": false, "aTargets": non_searchable_columns },
          { "sType": "html", "aTargets": [ andrewID_col ] },
          { "sType": "num-html", "aTargets": numeric_columns }, 
        ],
        "fnDrawCallback": function(oSettings) {
          var that = this;
          // Need to redo the counters if filtered or sorted
          if (oSettings.bSorted || oSettings.bFiltered) {
            asap(function() {
              that.$('td:first-child', { "filter": "applied" }).each(function(i) {
                  that.fnUpdate(i + 1, this.parentNode, 0, false, false);
              });
            });
          }
        },
        // "aaSorting": [[ andrewID_col, 'asc' ]] -- this is slowww
    }).fnSetFilteringDelay();

    console.log("datatables took: " + (new Date() - start));

    // placeholder text in Search field
    jQuery("#grades_filter input").attr("placeholder", "Search");

    // keyTable handles tabbing between cells, ESCaping from table, enter to enter editor
    var keyTable = new KeyTable({
        'table': document.getElementById("grades"),
        'datatable': oTable,
        'focus': [ first_problem_column, 0 ],
        'form': true,
        'start': first_problem_column,
        'num': problem_count
    });
    
    // get enclosing editor from inside of it
    function get_enclosing_editor(el) {
        return jQuery(el).closest('td.edit');
    }

    // for another day: make score red on save error: tombug#51
    /*function score_dirty(editor, status) {
        if (status == "success") {
            jQuery(editor).removeClass("error");
        } else if (status == "error") {
            jQuery(editor).addClass("error");
        } else {
           throw "score_dirty: come on, bro.";
        }
    }*/

    /* If objOrSel is:
     *  - selector with context, it is resolved into a jQuery object
     *  - a jQuery object, it is returned as is
     *
     * The results are undefined if it's neither.
     *
     * @param objOrSel jQuery object or { 'selector': s, 'selector_context': c }
     *
     * @return jQuery object
     */
    function normalizeToObject(objOrSel) {
        return (objOrSel instanceof jQuery) ? objOrSel : jQuery(objOrSel['selector'], objOrSel['selector_context']);
    }

    /* Tabs to next (previous, if reverse is true) tab object if it's visible.
     * If it isn't, tab to *its* next/previous tab object.
     * 
     * If the target is an array, it tabs to the first visible element.
     *
     * @param from      The object to tab from
     * @param reverse   Whether to tab in reverse (as a result of shift being held down)
     *
     * @return nothing
     */
    function tabber(from, reverse) { from = jQuery(from);
        console.log("tabbing");

        // guaranteed to be jQuery objects
        var tabNext = normalizeToObject(from.data('tabNext'));
        var tabPrev = normalizeToObject(from.data('tabPrev'));

        // choose targets based upon direction
        var targets = reverse ? tabPrev : tabNext;

        // set focus to the first visible target
        for (var i = 0; i < targets.length; i++) { var t = jQuery(targets[i]);
            if (t.is(':visible')) {
                t.focus();
                return;
            }
        }
    
        // none of the targets are visible, tab *from* the first target
        // TODO#1: what if no one in the tab cycle is visible anymore?
        if (targets.length > 0)
            tabber(targets.eq(0), reverse);
    }

    // always called when editor's closed, the hub for which is current_editor.reset()
    function _close_current_editor() {
        if (!current_editor.opening_another) {
            asap(function() { keyTable.block = false; });
        }
        close_current_popover();
        current_editor = null;
        console.log("closed editor");
    }

    function close_current_editor() {
        current_editor.reset();
    }

    // if click outside the current editor's surrounding area (the corresponding score popover, for now), close the current editor
    function close_current_editor_on_blur(event) {
        if (current_editor && jQuery(current_editor).closest("td.edit").find(event.target).length == 0) {
            close_current_editor();
        }
    }

    function close_current_popover() {
        current_popover.hide();
        current_popover = undefined;
        console.log("closed popover");
    }

    function close_current_popover_on_blur(event) {
        if (current_popover && jQuery(current_popover).closest("td").find(event.target).length == 0) {
            close_current_popover();
        }
    }

    /* Run f in the next runloop
     *
     * @param f Function to be executed
     */
    function asap(f) {
        setTimeout(f, 0); 
    }

    function open_editor(editable) {
        // if we're already open, we're done
        if (current_editor == editable) return;

        // if someone else is open, close them
        else if (current_editor) {
            current_editor.opening_another = true;
            close_current_editor();
        }

        // we're going to be in an editor, prevent KeyTable from processing keyboard input (prevent tabbing between table cells)
        keyTable.block = true;

        $editable = jQuery(editable);

        // lazily register editor events
        if ($editable.data("initialized") != true) {
          make_editable($editable);
          asap(function() {
            register_editor_events($editable);
            $editable.click();
          });
          $editable.data("initialized", true);
        }

        console.log("opening editor");
        open_score_popover(editable);
        current_editor = editable;
    }

    function make_editable($editable) {
      // click/enter to edit cells
      $editable.editable('quickSetScore', {
          name: 'score',
          event: "click",
          placeholder: "&ndash;",
          indicator: '<img src="/assets/spinner.gif"></img>',
          select: true, // select all text in score editor on click/enter
          onblur: function() {
          },
          onreset: function(event) {
              _close_current_editor();
          },
          onerror: function() {
              jQuery(current_editor).effect('highlight', { color: 'red' }, 400);
              close_current_editor();
          },
          submitdata: function(value, settings) {
              return {
                  submission_id: get_enclosing_editor(this).data("submission-id"),
                  problem_id: get_enclosing_editor(this).data("problem-id")
              }
          },
          callback: function(value, settings) {
              var editor = get_enclosing_editor(this);
              var total = editor.siblings(".total");
        
              // also always submit score details
              submit_score_details(editor);

              jQuery.ajax("quickGetTotal", {
                  data: {
                      submission_id: editor.data('submission-id')
                  }, 
                  success: function(data, status, jqXHR) {
                      // TODO: wtf
                      total.html(data == " " ? "&ndash;" : data);
                      total.effect("highlight", {}, 1000);
                  },
                  error: function() {
                      total.text("?");
                  }
              });
              _close_current_editor();
          }
      });
    }

    function register_editor_events($editable) {
      var editor = get_enclosing_editor($editable);
      
      $editable.data('tabNext', jQuery('textarea.feedback', editor));
      $editable.data('tabPrev', jQuery('.save_box .save, .save_box .error', editor));

      jQuery("input", $editable).live('keydown', function(event) {
          if (event.keyCode == TAB_KEY) {
              event.preventDefault();
              tabber(jQuery(this).closest('div.editable'), event.shiftKey);
          }
      });

      var feedback = jQuery("textarea.feedback", editor) 
      feedback.data('tabNext', jQuery('.save_box .save, .save_box .error', editor));
      feedback.data('tabPrev', { selector: "div.editable input", selector_context: editor });

      feedback.keydown(function(event) {
          if (event.keyCode == TAB_KEY) {
              event.preventDefault();
              tabber(this, event.shiftKey);
          }
      });

      var save_error = jQuery('.save_box .save, .save_box .error', editor);
      save_error.data('tabPrev', jQuery('textarea.feedback', editor));
      save_error.data('tabNext', { selector: "div.editable input", selector_context: editor });

      save_error.keydown(function(event) {
          if (event.keyCode == TAB_KEY) {
              event.preventDefault();
              tabber(this, event.shiftKey);
          } else if (event.keyCode == ENTER_KEY) {
              submit_score_details(get_enclosing_editor(this));
          }
      });

      save_error.click(function(event) {
          submit_score_details(get_enclosing_editor(this));
      });
    }

    function submit_score_details(editor, not_score) {
        var released = jQuery('table.score_details input.released', editor).is(':checked');
        jQuery.ajax("quickSetScoreDetails", {
            type: 'POST',
            data: {
                submission_id: editor.data('submission-id'),
                problem_id: editor.data('problem-id'),
                feedback: jQuery('table.score_details textarea.feedback', editor).val(),
                released: released,
                score: jQuery(".editable input", editor).val()  // currently unused -- tombug#50
            },
            success: function(data, status, jqXHR) {
                if (!not_score) {
                    console.log("submit_score_details: submitting editor as well");
                    jQuery('div.editable form', editor).submit();
                } else {
                    console.log("submit_score_details: not submitting editor");
                }
        
                // update score id
                editor.data('score-id', data)

                // code to update reloased score formatting
                if (released) {
                    jQuery(editor).addClass("released");
                } else {
                    jQuery(editor).removeClass("released");
                }
                score_details_dirty(editor, "saved");
            },
            error: function() {
                score_details_dirty(editor, "error");
            }
        });
        score_details_dirty(editor, "saving");
    }

    var $editables = jQuery("#grades td.edit div.editable");
    $editables.live('click', function(event) {
        open_editor(this);
    });

    keyTable.event.action(null, null, function(nCell) {
        jQuery('div.editable', nCell).click();
    });

    keyTable.event.esc(null, null, function() {
        jQuery("#grades_filter input").focus();
        keyTable.fnBlur();
    });

    jQuery("#grades_filter input").keydown(function(event){
            if (event.keyCode === 13) { // return
                asap(function() { jQuery(focusser).focus(); });
            } else if (event.keyCode === 27) { // esc
                event.preventDefault();
                jQuery(this).val("");
            }
    });

    jQuery('#grades_filter input').focus()

      jQuery(document).click(function(event) {
        close_current_editor_on_blur(event);
        close_current_popover_on_blur(event);
      });

    // generic popover opening engine
    function show_popover(popover, at, arrow_at) {
      if (current_editor) close_current_editor();
      if (current_popover) close_current_popover();

      // show popover
      console.log("opening popover");
      popover.show();
      popover.position(at);

      // show arrow
      var arrow = jQuery(".arrow", popover)
        if (arrow_at) {
          arrow.position(arrow_at);
        } else {
          arrow.position({
            my: "right",
            at: "left",
            of: popover
          });
        }

      // TODO: quick hack to remove awkward incorrectly directed arrow on popover flip: tombug#49
      if (popover.position().left < at.of.position().left)
        arrow.hide();

      current_popover = popover;
    }

    // to show the the ID column popovers
    jQuery('#grades td.id a.andrewID').live('click', function() {
      jQuery('div.popover').hide();

      var link = jQuery(this)
      var popover = link.siblings("div.popover")

      jQuery.ajax("submission_popover", {
        data: { submission_id: link.parent().data("submission-id") },
        success: function(data, status, jqXHR) {
          popover.html(data)
        show_popover(popover, {
          my: "left center",
        at: "right center",
        of: link,
        offset: "10px 0"
        });
        }
      });
    });

    function open_score_popover(e) {
      var $editable = jQuery(e)
        var $popover = $editable.siblings("div.popover")
        var $td = $editable.parent()
        var $score_details_tbody = jQuery("tbody", $popover)
        var score_id = $td.data("score-id")

        // lazy load grader
        if (score_id) {
          jQuery.ajax("score_grader_info", {
            data: {
              id: score_id
            },
            success: function(data, status, jqXHR) {
              jQuery(".grader", $score_details_tbody).parent().remove();
              // TODO: wtf?
              if (data != " ") {
                $score_details_tbody.prepend("<tr><th>Grader</th><td class='grader'>" + data + "</td></tr>")
              }
            }
          });
        }

      show_popover($popover, {
        my: "left center",
      at: "right center",
      of: $popover.parent(),
      offset: "5px 0"
      });
    }

    // TODO: idempotent. made so due to bad dirtying algorithm
    function score_details_dirty(editor, state) {
        editor.data("score-details-state", state);
        jQuery(".save_box *", editor).blur();
        if (state == "dirty") {
            jQuery(".save_box *", editor).hide();
            jQuery(".save", editor).show();
        } else if (state == "saving") {
            jQuery(".save_box *", editor).hide();
            jQuery(".save", editor).show();
        } else if (state == "saved") {
            jQuery(".save_box *", editor).hide();
            jQuery(".save", editor).show();
        } else if (state == "error") {
            jQuery(".save_box *", editor).hide();
            jQuery(".error", editor).show();
            jQuery(".error", editor).focus();
        } else {
            throw "score_details_dirty: come on, bro";
        } 
    }
    
    var dirty = function(event) {
        score_details_dirty(get_enclosing_editor(event.target), "dirty");
    }
    
    //jQuery("table.score_details textarea.feedback").live('keypress', dirty);
    //jQuery("table.score_details input.released").live('click', dirty);
    //jQuery(".editable input").keypress(dirty); -- for some other day tombug#50

    console.log(new Date() - start)
});
